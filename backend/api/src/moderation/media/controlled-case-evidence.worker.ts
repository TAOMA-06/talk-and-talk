import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { PrismaService } from "../../database/prisma.service";
import { ModerationCategory, ModerationService } from "../moderation.service";
import { RuleEngine } from "../rule-engine";
import {
  CONTROLLED_EVIDENCE_PURPOSES,
  MediaAssetService
} from "./media-asset.service";
import {
  MEDIA_ANALYSIS_PROVIDER,
  MediaAnalysisProvider,
  MediaAnalysisResult
} from "./media-provider.interface";

const PROCESSING_LEASE_MS = 10 * 60_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];
const BATCH_SIZE = 20;

/**
 * Moderates standalone case evidence before a business record can consume it.
 * Unlike chat media, these assets have no Message row to own a moderation
 * lease, so the lease lives on MediaAsset and only `approved` is bindable.
 */
@Injectable()
export class ControlledCaseEvidenceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ControlledCaseEvidenceWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAssets: MediaAssetService,
    @Inject(MEDIA_ANALYSIS_PROVIDER) private readonly analysisProvider: MediaAnalysisProvider,
    private readonly moderation: ModerationService,
    private readonly ruleEngine: RuleEngine
  ) {}

  onModuleInit() {
    if (!this.mediaAssets.isCaseEvidenceMediaEnabled()) return;
    this.timer = setInterval(() => this.processPendingSafely(), 30_000);
    this.timer.unref?.();
    this.processPendingSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  enqueue(assetId: string) {
    if (!this.mediaAssets.isCaseEvidenceMediaEnabled()) return;
    setTimeout(() => this.processAssetSafely(assetId), 0).unref?.();
  }

  async processPending() {
    if (!this.mediaAssets.isCaseEvidenceMediaEnabled() || this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
      const assets: any[] = await this.prisma.mediaAsset.findMany({
        where: {
          purpose: { in: [...CONTROLLED_EVIDENCE_PURPOSES] },
          status: "scanning",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          AND: [{
            OR: [
              { moderationProcessingToken: null },
              { moderationProcessingAt: { lt: staleBefore } }
            ]
          }]
        },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE
      } as any);
      await Promise.all(assets.map((asset) => this.processAsset(asset.id)));
    } finally {
      this.running = false;
    }
  }

  async processAsset(assetId: string): Promise<void> {
    const asset: any = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        purpose: { in: [...CONTROLLED_EVIDENCE_PURPOSES] },
        status: "scanning"
      }
    } as any);
    if (!asset || (asset.nextAttemptAt && asset.nextAttemptAt > new Date())) return;

    const token = randomUUID();
    const claimed = await this.prisma.mediaAsset.updateMany({
      where: {
        id: asset.id,
        status: "scanning",
        OR: [
          { moderationProcessingToken: null },
          { moderationProcessingAt: { lt: new Date(Date.now() - PROCESSING_LEASE_MS) } }
        ]
      },
      data: { moderationProcessingToken: token, moderationProcessingAt: new Date() }
    } as any);
    if (claimed.count !== 1) return;

    try {
      const mediaResult = asset.kind === "image"
        ? await this.analysisProvider.analyzeImage(this.mediaAssets.toReference(asset))
        : await this.analysisProvider.transcribeAudio(this.mediaAssets.toReference(asset));
      if (!mediaResult.available) {
        await this.retryOrFail(asset, token);
        return;
      }

      const textResult = await this.moderation.moderateAsync(
        mediaResult.extractedText?.trim() || "[case evidence media]",
        "report"
      );
      const score = Math.max(mediaResult.score, textResult.score);
      const categories = this.categories(textResult.categories, mediaResult.categories);
      const decision = this.ruleEngine.decisionFor(score);
      const status = decision === "allow"
        ? "approved"
        : decision === "block"
          ? "blocked"
          : "reviewRequired";
      await this.prisma.mediaAsset.updateMany({
        where: { id: asset.id, status: "scanning", moderationProcessingToken: token },
        data: {
          status,
          // Do not persist OCR/transcript text from case evidence. The business
          // statement remains the only user-authored narrative retained here.
          extractedText: null,
          analysis: {
            score,
            categories,
            decision,
            policyVersion: textResult.policyVersion,
            provider: mediaResult.provider ?? this.analysisProvider.name,
            providerVersion: mediaResult.providerVersion ?? null
          },
          provider: mediaResult.provider ?? this.analysisProvider.name,
          providerVersion: mediaResult.providerVersion ?? null,
          retryCount: 0,
          nextAttemptAt: null,
          lastError: status === "approved" ? null : "case_evidence_not_approved",
          moderationProcessingToken: null,
          moderationProcessingAt: null
        }
      } as any);
    } catch {
      await this.retryOrFail(asset, token);
    }
  }

  private async retryOrFail(asset: any, token: string) {
    const retryCount = (asset.retryCount ?? 0) + 1;
    const exhausted = retryCount > MAX_RETRIES;
    await this.prisma.mediaAsset.updateMany({
      where: { id: asset.id, status: "scanning", moderationProcessingToken: token },
      data: {
        status: exhausted ? "failed" : "scanning",
        retryCount,
        nextAttemptAt: exhausted ? null : new Date(Date.now() + RETRY_DELAYS_MS[retryCount - 1]),
        lastError: exhausted ? "case_evidence_moderation_unavailable" : "case_evidence_moderation_retrying",
        moderationProcessingToken: null,
        moderationProcessingAt: null
      }
    } as any);
  }

  private categories(
    textCategories: ModerationCategory[],
    mediaCategories: string[]
  ): ModerationCategory[] {
    const known = new Set<ModerationCategory>([
      "privateContact", "offlineMeetup", "privatePayment", "fraudOrSpam",
      "sexualContent", "harassmentOrHate", "privacy", "selfHarm", "violence", "normal"
    ]);
    const merged = [...new Set([
      ...textCategories,
      ...mediaCategories.filter((item): item is ModerationCategory => known.has(item as ModerationCategory))
    ])];
    const nonNormal = merged.filter((item) => item !== "normal");
    return nonNormal.length ? nonNormal : ["normal"];
  }

  private processPendingSafely() {
    void this.processPending().catch((error) => {
      this.logger.error(`Controlled evidence scan failed (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }

  private processAssetSafely(assetId: string) {
    void this.processAsset(assetId).catch((error) => {
      this.logger.error(`Controlled evidence enqueue failed for ${assetId} (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }
}
