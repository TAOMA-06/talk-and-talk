import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { CrisisInterventionService } from "../../crisis-intervention/crisis-intervention.service";
import { PrismaService } from "../../database/prisma.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { ChatRestrictionService } from "../chat-restriction.service";
import {
  ModerationCategory,
  ModerationResult,
  ModerationService
} from "../moderation.service";
import { ModerationCaseService } from "../moderation-case.service";
import { RuleEngine } from "../rule-engine";
import { MEDIA_ANALYSIS_PROVIDER, MediaAnalysisProvider, MediaAnalysisResult } from "./media-provider.interface";
import { MediaAssetService } from "./media-asset.service";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];
const PROCESSING_LEASE_MS = 10 * 60_000;
const MAINTENANCE_MAX_BATCHES_PER_RUN = 10;
const QUEUED_MEDIA_BATCH_SIZE = 20;
const CONTINUATION_DELAY_MS = 1_000;

@Injectable()
export class MediaModerationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaModerationWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private continuationTimer: NodeJS.Timeout | null = null;
  private processingPending = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAssets: MediaAssetService,
    @Inject(MEDIA_ANALYSIS_PROVIDER) private readonly analysisProvider: MediaAnalysisProvider,
    private readonly moderation: ModerationService,
    private readonly ruleEngine: RuleEngine,
    private readonly cases: ModerationCaseService,
    private readonly restrictions: ChatRestrictionService,
    private readonly notifications: NotificationsService,
    private readonly crisisIntervention: CrisisInterventionService
  ) {}

  onModuleInit() {
    if (!this.mediaAssets.isFeatureEnabled()) return;
    this.timer = setInterval(() => this.processPendingSafely(), 30_000);
    this.timer.unref?.();
    this.processPendingSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.continuationTimer) clearTimeout(this.continuationTimer);
    this.timer = null;
    this.continuationTimer = null;
  }

  enqueue(messageId: string) {
    if (!this.mediaAssets.isFeatureEnabled()) return;
    setTimeout(() => this.processMessageSafely(messageId), 0).unref?.();
  }

  async processPending() {
    if (!this.mediaAssets.isFeatureEnabled() || this.processingPending) return;
    this.processingPending = true;
    let continuationRequired = false;
    try {
      for (let batch = 0; batch < MAINTENANCE_MAX_BATCHES_PER_RUN; batch += 1) {
        const expiry = await this.mediaAssets.expireDueAssets();
        if (!expiry?.hasMore) break;
        if (batch === MAINTENANCE_MAX_BATCHES_PER_RUN - 1) {
          continuationRequired = true;
        }
      }
      const now = new Date();
      const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
      const messageCandidates: any[] = await this.prisma.message.findMany({
        where: {
          moderationStatus: "queued",
          // A message is processed atomically with all of its attachments. Do
          // not let an older message in provider backoff occupy the head of the
          // queue and starve later ready messages.
          attachments: {
            some: {},
            every: {
              OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
            }
          },
          OR: [
            { moderationProcessingToken: null },
            { moderationProcessingAt: { lt: staleBefore } }
          ]
        },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: QUEUED_MEDIA_BATCH_SIZE + 1
      } as any);
      const messages = messageCandidates.slice(0, QUEUED_MEDIA_BATCH_SIZE);
      continuationRequired ||= messageCandidates.length > QUEUED_MEDIA_BATCH_SIZE;
      await Promise.all(messages.map((message) => this.processMessage(message.id)));
    } finally {
      this.processingPending = false;
      if (continuationRequired) this.scheduleContinuation();
    }
  }

  private scheduleContinuation(): void {
    if (this.continuationTimer) return;
    this.continuationTimer = setTimeout(() => {
      this.continuationTimer = null;
      this.processPendingSafely();
    }, CONTINUATION_DELAY_MS);
    this.continuationTimer.unref?.();
  }

  private processPendingSafely(): void {
    void this.processPending().catch((error) => {
      this.logger.error(`Media moderation scan failed (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }

  private processMessageSafely(messageId: string): void {
    void this.processMessage(messageId).catch((error) => {
      this.logger.error(`Media moderation enqueue failed for ${messageId} (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }

  async processMessage(messageId: string): Promise<void> {
    const message: any = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        attachments: true,
        conversation: {
          select: {
            id: true,
            externalId: true,
            userId: true,
            companion: { select: { ownerUserId: true } }
          }
        }
      }
    } as any);
    if (!message || message.moderationStatus !== "queued" || !message.attachments.length) return;
    if (message.attachments.some((asset: any) => asset.nextAttemptAt && asset.nextAttemptAt > new Date())) return;

    const processingToken = randomUUID();
    const claimed = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        moderationStatus: "queued",
        OR: [
          { moderationProcessingToken: null },
          { moderationProcessingAt: { lt: new Date(Date.now() - PROCESSING_LEASE_MS) } }
        ]
      },
      data: { moderationProcessingToken: processingToken, moderationProcessingAt: new Date() }
    } as any);
    if (claimed.count !== 1) return;

    let criticalSafetyTransactionRequired = false;
    try {
      const analysis = await this.analyzeAssets(message.attachments);
      if (!analysis.available) {
        await this.scheduleRetryOrReview(message, analysis.result, processingToken);
        return;
      }

      const moderation = await this.moderateMessage(message, analysis);
      criticalSafetyTransactionRequired = moderation.priority === "critical"
        && (moderation.categories.includes("selfHarm") || moderation.categories.includes("violence"));
      const moderatedStatus = moderation.decision === "allow"
        ? "published"
        : moderation.decision === "block"
          ? "blocked"
          : "pendingReview";
      const now = new Date();

      const transitioned = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        // Block/unblock operations take the same conversation row lock. This
        // stops a queued media item from becoming visible after either side has
        // chosen to end message interaction.
        if (typeof db.$queryRaw === "function") {
          await db.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${message.conversationId} FOR UPDATE`;
        }
        const interactionBlocked = await db.conversationBlock.findFirst({
          where: { conversationId: message.conversationId },
          select: { id: true }
        });
        const nextStatus = interactionBlocked ? "blocked" : moderatedStatus;
        const nextVisibility = nextStatus === "published" ? "participants" : "senderOnly";
        const transition = await db.message.updateMany({
          where: {
            id: message.id,
            moderationStatus: "queued",
            moderationProcessingToken: processingToken
          },
          data: {
            moderationStatus: nextStatus,
            visibility: nextVisibility,
            moderationDecision: moderation.decision,
            policyVersion: moderation.policyVersion,
            reviewedAt: nextStatus === "published" ? now : null,
            moderationProcessingToken: null,
            moderationProcessingAt: null
          }
        });
        if (transition.count !== 1) return false;
        for (const item of analysis.items) {
          await db.mediaAsset.update({
            where: { id: item.asset.id },
            data: {
              status: moderation.decision === "block" ? "blocked" : "approved",
              extractedText: item.result.extractedText ?? null,
              analysis: this.analysisPayload(item.result),
              provider: item.result.provider ?? this.analysisProvider.name,
              providerVersion: item.result.providerVersion ?? null,
              retryCount: 0,
              nextAttemptAt: null,
              lastError: null
            }
          });
        }
        if (moderation.decision !== "allow") {
          const moderationCase = await this.cases.createFromResult({
            result: moderation,
            source: "chat",
            content: this.evidenceText(message.content, analysis),
            targetId: message.conversationId,
            conversationId: message.conversationId,
            messageId: message.id,
            subjectUserId: message.senderId,
            actorId: message.senderId,
            db
          });
          if (moderation.decision === "block" && moderationCase) {
            await this.restrictions.recordAutomaticHighRiskBlock(
              message.senderId,
              moderationCase.id,
              db
            );
          }
        }
        // Media analysis runs later, but the claimed message still supplies the
        // authenticated uploader. Keep crisis ownership away from the other
        // conversation participant and persist no extracted text or message id.
        await this.crisisIntervention.recordCriticalChatSignal(
          message.senderId,
          { priority: moderation.priority, categories: moderation.categories },
          db
        );
        if (moderation.priority === "critical") {
          await this.createCriticalSafetyMessage(db, message);
        }
        await db.conversation.update({ where: { id: message.conversationId }, data: { updatedAt: now } });
        if (nextStatus === "published") {
          const recipientUserId = message.conversation.userId === message.senderId
            ? message.conversation.companion.ownerUserId
            : message.conversation.userId;
          if (recipientUserId && recipientUserId !== message.senderId) {
            // Media-derived text and attachments stay in the moderation path.
            // This helper receives only ids and never reads their contents.
            await this.notifications.createConversationMessageReceivedIfUnmuted(db, {
              conversationId: message.conversationId,
              messageId: message.id,
              recipientUserId,
              recipientConversationId: recipientUserId === message.conversation.userId
                ? message.conversation.externalId
                : message.conversation.id
            });
          }
        }
        return true;
      });
      if (!transitioned) return;

    } catch (error) {
      // Never turn a failed critical-safety transaction into an ordinary media
      // provider retry that eventually expires into generic human review. The
      // message stays queued and sender-only until the complete transaction,
      // including the crisis gate, can commit.
      if (criticalSafetyTransactionRequired) {
        await this.releaseClaim(message.id, processingToken);
        throw error;
      }
      await this.scheduleRetryOrReview(message, {
        available: false,
        score: 0.05,
        reasons: [error instanceof Error ? error.message : "媒体审核服务异常"],
        categories: [],
        provider: this.analysisProvider.name
      }, processingToken);
    }
  }

  private async analyzeAssets(assets: any[]) {
    const items = await Promise.all(assets.map(async (asset) => ({
      asset,
      result: asset.kind === "image"
        ? await this.analysisProvider.analyzeImage(this.mediaAssets.toReference(asset))
        : await this.analysisProvider.transcribeAudio(this.mediaAssets.toReference(asset))
    })));
    const unavailable = items.find((item) => !item.result.available);
    return {
      available: !unavailable,
      items,
      result: unavailable?.result ?? null
    };
  }

  private async moderateMessage(message: any, analysis: { items: Array<{ asset: any; result: MediaAnalysisResult }> }) {
    const [recentMessages, recentHighRiskBlocks] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          conversationId: message.conversationId,
          moderationStatus: "published",
          id: { not: message.id }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        select: { content: true }
      } as any),
      this.prisma.moderationCase.count({
        where: {
          subjectUserId: message.senderId,
          decision: "block",
          riskLevel: "high",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      } as any)
    ]);
    const extractedText = analysis.items
      .map((item) => item.result.extractedText?.trim())
      .filter((text): text is string => Boolean(text));
    const text = [message.content.trim(), ...extractedText].filter(Boolean).join("\n");
    const textResult = await this.moderation.moderateAsync(text || "[media]", "chat", {
      recentMessages: recentMessages.map((item: any) => item.content).reverse(),
      recentHighRiskBlocks
    });
    const mediaScore = Math.max(...analysis.items.map((item) => item.result.score), 0.05);
    const score = Math.max(textResult.score, mediaScore);
    const categories = normalizeCategories([
      ...textResult.categories,
      ...analysis.items.flatMap((item) => item.result.categories as ModerationCategory[])
    ]);
    const decision = this.ruleEngine.decisionFor(score);
    return {
      ...textResult,
      decision,
      riskLevel: this.ruleEngine.riskLevelFor(score),
      priority: priorityFor(decision, categories),
      score,
      categories,
      reasons: combinedReasons(textResult, analysis.items),
      provider: analysis.items.find((item) => item.result.provider)?.result.provider ?? textResult.provider,
      providerVersion: analysis.items.find((item) => item.result.providerVersion)?.result.providerVersion ?? textResult.providerVersion,
      usedAI: textResult.usedAI || analysis.items.some((item) => item.result.available)
    } as ModerationResult;
  }

  private async scheduleRetryOrReview(
    message: any,
    unavailable?: MediaAnalysisResult | null,
    processingToken?: string
  ) {
    const retryCount = Math.max(...message.attachments.map((asset: any) => asset.retryCount ?? 0)) + 1;
    if (retryCount <= MAX_RETRIES) {
      const nextAttemptAt = new Date(Date.now() + RETRY_DELAYS_MS[retryCount - 1]);
      await this.prisma.mediaAsset.updateMany({
        where: { id: { in: message.attachments.map((asset: any) => asset.id) } },
        data: {
          status: "uploaded",
          retryCount,
          nextAttemptAt,
          lastError: unavailable?.reasons.join("；") || "媒体审核服务暂不可用"
        }
      } as any);
      if (processingToken) await this.releaseClaim(message.id, processingToken);
      return;
    }

    const result: ModerationResult = {
      decision: "review",
      riskLevel: "medium",
      priority: "high",
      score: 0.55,
      reasons: ["媒体审核服务暂不可用，已升级人工复核"],
      matchedRules: ["media.providerUnavailable"],
      categories: ["normal"],
      policyVersion: "chat-v2",
      provider: unavailable?.provider ?? this.analysisProvider.name,
      providerVersion: unavailable?.providerVersion,
      usedAI: false
    };
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      if (processingToken) {
        const transitioned = await db.message.updateMany({
          where: {
            id: message.id,
            moderationStatus: "queued",
            moderationProcessingToken: processingToken
          },
          data: {
            moderationStatus: "pendingReview",
            visibility: "senderOnly",
            moderationDecision: "review",
            policyVersion: result.policyVersion,
            moderationProcessingToken: null,
            moderationProcessingAt: null
          }
        });
        if (transitioned.count !== 1) return;
      } else {
        await db.message.update({
          where: { id: message.id },
          data: {
            moderationStatus: "pendingReview",
            visibility: "senderOnly",
            moderationDecision: "review",
            policyVersion: result.policyVersion
          }
        });
      }
      await db.mediaAsset.updateMany({
        where: { id: { in: message.attachments.map((asset: any) => asset.id) } },
        data: {
          status: "failed", retryCount, nextAttemptAt: null, lastError: result.reasons[0]
        }
      });
      await this.cases.createFromResult({
        result,
        source: "chat",
        content: this.evidenceText(message.content, { items: [] }),
        targetId: message.conversationId,
        conversationId: message.conversationId,
        messageId: message.id,
        subjectUserId: message.senderId,
        actorId: message.senderId,
        db
      });
    });
  }

  private async releaseClaim(messageId: string, processingToken: string) {
    await this.prisma.message.updateMany({
      where: {
        id: messageId,
        moderationStatus: "queued",
        moderationProcessingToken: processingToken
      },
      data: { moderationProcessingToken: null, moderationProcessingAt: null }
    } as any);
  }

  private analysisPayload(result: MediaAnalysisResult) {
    return {
      score: result.score,
      reasons: result.reasons,
      categories: result.categories,
      provider: result.provider ?? this.analysisProvider.name,
      providerVersion: result.providerVersion ?? null
    };
  }

  private evidenceText(content: string, analysis: { items: Array<{ asset: any; result: MediaAnalysisResult }> }) {
    const extracted = analysis.items.map((item) => item.result.extractedText).filter(Boolean).join("\n");
    return [content, extracted].filter(Boolean).join("\n").slice(0, 2000) || "[媒体消息]";
  }

  private async createCriticalSafetyMessage(db: any, message: any) {
    await db.message.create({
      data: {
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: "系统",
        content: "安全提醒：如果你正处于危险或需要即时帮助，请优先联系可信赖的人或当地紧急求助渠道。你的消息已进入优先复核。",
        type: "safety",
        moderationStatus: "published",
        visibility: "senderOnly",
        policyVersion: "chat-v2"
      }
    } as any);
  }
}

function normalizeCategories(categories: ModerationCategory[]): ModerationCategory[] {
  const unique = [...new Set(categories.filter(Boolean))];
  const nonNormal = unique.filter((category) => category !== "normal");
  return nonNormal.length ? nonNormal : ["normal"];
}

function priorityFor(decision: ModerationResult["decision"], categories: ModerationCategory[]) {
  if (categories.includes("selfHarm") || categories.includes("violence")) return "critical" as const;
  if (decision === "block" || decision === "warn") return "high" as const;
  return "normal" as const;
}

function combinedReasons(
  textResult: ModerationResult,
  items: Array<{ result: MediaAnalysisResult }>
) {
  const reasons = [...new Set([
    ...textResult.reasons.filter((reason) => reason !== "内容正常"),
    ...items.flatMap((item) => item.result.reasons)
  ])];
  return reasons.length ? reasons : ["内容正常"];
}
