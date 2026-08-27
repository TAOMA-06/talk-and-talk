import { createHash, createHmac } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { lockStaffCredentialRowsInOrder } from "../admin/staff-credential-lock-order";
import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { isFirstReleaseCapabilityEnabled } from "../config/first-release-capability-matrix";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ControlledCaseEvidenceService } from "../moderation/media/controlled-case-evidence.service";
import {
  AssignCompanionAppealDto,
  AssignCompanionIncidentDto,
  CompleteCompanionReactivationDto,
  CreateCompanionAccountActionDto,
  CreateCompanionAppealDto,
  CreateCompanionIncidentDto,
  CreateWithdrawalRequestDto,
  ResolveCompanionAppealDto,
  ResolveCompanionIncidentDto,
  ReviewCompanionVoiceIntroDto,
  SubmitTrainingAttemptDto,
  UpdateWithdrawalRequestDto
} from "./dto/companion-lifecycle.dto";
import { UpsertCompanionCommercialProfileDto } from "./dto/upsert-companion-commercial-profile.dto";
import { CommercialService } from "./commercial.service";

type TrainingQuestion = {
  id: string;
  prompt: string;
  options: Array<{ value: "A" | "B" | "C" | "D"; label: string }>;
  answer: "A" | "B" | "C" | "D";
};

type TrainingModule = {
  code: string;
  version: string;
  title: string;
  kind: "onboarding" | "required" | "continuingEducation";
  summary: string;
  passScore: number;
  validityDays: number;
  questions: TrainingQuestion[];
};

const TRAINING_MODULES: TrainingModule[] = [
  {
    code: "service-boundaries",
    version: "2026.1",
    title: "服务边界与履约",
    kind: "onboarding",
    summary: "确认陪伴服务不是医疗、心理治疗或紧急救援，并掌握订单内履约边界。",
    passScore: 67,
    validityDays: 365,
    questions: [
      {
        id: "scope",
        prompt: "用户要求你作出诊断或治疗承诺时，正确做法是什么？",
        options: [
          { value: "A", label: "根据经验直接判断" },
          { value: "B", label: "说明服务边界并建议寻求合格专业人员" },
          { value: "C", label: "转到站外继续沟通" },
          { value: "D", label: "为了留住用户先答应" }
        ],
        answer: "B"
      },
      {
        id: "off-platform",
        prompt: "用户邀请你交换私人联系方式时，正确做法是什么？",
        options: [
          { value: "A", label: "只在第一次服务交换" },
          { value: "B", label: "金额较小时可以" },
          { value: "C", label: "拒绝并继续使用平台内沟通" },
          { value: "D", label: "让用户决定" }
        ],
        answer: "C"
      },
      {
        id: "evidence",
        prompt: "发生订单争议时应当如何提交事实？",
        options: [
          { value: "A", label: "只提交与订单直接相关的事实和受控证据引用" },
          { value: "B", label: "公开用户隐私来证明自己" },
          { value: "C", label: "删除聊天记录" },
          { value: "D", label: "在社区发帖施压" }
        ],
        answer: "A"
      }
    ]
  },
  {
    code: "safety-escalation",
    version: "2026.1",
    title: "安全识别与升级",
    kind: "required",
    summary: "识别骚扰、现实危险和紧急风险；会使用安全退出与平台工单。",
    passScore: 67,
    validityDays: 180,
    questions: [
      {
        id: "urgent",
        prompt: "用户描述正在发生的现实人身危险时，首要做法是什么？",
        options: [
          { value: "A", label: "独自承担并持续聊天" },
          { value: "B", label: "承诺绝对保密" },
          { value: "C", label: "按平台紧急流程升级，并建议联系当地紧急服务" },
          { value: "D", label: "结束后再记录" }
        ],
        answer: "C"
      },
      {
        id: "harassment",
        prompt: "服务中遭遇骚扰或越界时，可以采取什么动作？",
        options: [
          { value: "A", label: "继续服务直到计时结束" },
          { value: "B", label: "安全退出、保留受控证据并提交事件" },
          { value: "C", label: "公布用户信息" },
          { value: "D", label: "私下报复" }
        ],
        answer: "B"
      },
      {
        id: "claims",
        prompt: "提交安全事件后，什么状态才代表平台已经解决？",
        options: [
          { value: "A", label: "客户端显示提交成功" },
          { value: "B", label: "证据上传开始" },
          { value: "C", label: "案件出现已解决或已关闭及处理结论" },
          { value: "D", label: "发送了一条消息" }
        ],
        answer: "C"
      }
    ]
  },
  {
    code: "privacy-refresh",
    version: "2026.1",
    title: "隐私与数据最小化复训",
    kind: "continuingEducation",
    summary: "只处理履约所需信息，不在证据、备注或站外工具中扩散敏感资料。",
    passScore: 67,
    validityDays: 180,
    questions: [
      {
        id: "minimum",
        prompt: "记录订单事实时应遵循什么原则？",
        options: [
          { value: "A", label: "尽可能多保存" },
          { value: "B", label: "只保存解决该事件所必需的信息" },
          { value: "C", label: "复制到个人云盘" },
          { value: "D", label: "永久保存" }
        ],
        answer: "B"
      },
      {
        id: "documents",
        prompt: "身份证件和银行卡资料应该如何处理？",
        options: [
          { value: "A", label: "填写原文到客服备注" },
          { value: "B", label: "发到群聊复核" },
          { value: "C", label: "只提交平台或供应商生成的外部引用和掩码" },
          { value: "D", label: "截图保存在相册" }
        ],
        answer: "C"
      },
      {
        id: "retention",
        prompt: "服务结束后，本地保存的用户敏感资料应如何处理？",
        options: [
          { value: "A", label: "用于以后营销" },
          { value: "B", label: "转发给其他陪伴者" },
          { value: "C", label: "按平台规则删除，不自行留存" },
          { value: "D", label: "长期归档" }
        ],
        answer: "C"
      }
    ]
  }
];

const REQUIRED_TRAINING_CODES = TRAINING_MODULES.map((module) => module.code);
const ACTIVE_WITHDRAWAL_STATUSES = ["requested", "reviewing", "approved", "processing"] as const;
const ACTIVE_COMPANION_INCIDENT_STATUSES = ["open", "inReview"] as const;

@Injectable()
export class CompanionLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commercial: CommercialService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly caseEvidence: ControlledCaseEvidenceService
  ) {}

  async overview(userId: string) {
    const companion = await this.ownCompanion(userId);
    const voiceIntroEnabled = this.isVoiceIntroEnabled();
    const [commercialProfile, training, quality, actions, incidents, withdrawals, operationalSummary] = await Promise.all([
      this.commercialProfileForCompanion(companion.id),
      this.trainingForCompanion(companion.id),
      this.qualityForCompanion(companion.id),
      this.actionsForCompanion(companion.id),
      this.incidentsForCompanion(companion.id),
      this.withdrawalsForCompanion(companion.id),
      this.operationalSummaryForCompanion(companion.id)
    ]);
    return {
      companion: {
        id: companion.id,
        name: companion.name,
        role: companion.role,
        bio: companion.bio,
        languages: companion.languages,
        specialties: companion.specialties,
        cityDistrict: companion.cityDistrict,
        livedExperience: companion.livedExperience ?? null,
        serviceBoundaries: companion.serviceBoundaries ?? [],
        isPublished: companion.isPublished,
        voiceIntro: {
          // Preserve a truthful review state for the owner, but never return a
          // historical storage reference or playback metadata on text-only.
          assetReference: voiceIntroEnabled ? companion.voiceIntroAssetRef ?? null : null,
          durationSeconds: voiceIntroEnabled ? companion.voiceIntroDurationSeconds ?? null : null,
          status: companion.voiceIntroStatus
        }
      },
      commercialProfile,
      training,
      quality,
      actions,
      incidents,
      withdrawals,
      operationalSummary
    };
  }

  async commercialProfile(userId: string) {
    const companion = await this.ownCompanion(userId);
    return this.commercialProfileForCompanion(companion.id);
  }

  async submitCommercialProfile(userId: string, input: UpsertCompanionCommercialProfileDto) {
    const companion = await this.ownCompanion(userId);
    return this.commercial.upsertCommercialProfile(userId, companion.id, input);
  }

  async training(userId: string) {
    const companion = await this.ownCompanion(userId);
    return this.trainingForCompanion(companion.id);
  }

  async submitTrainingAttempt(userId: string, input: SubmitTrainingAttemptDto) {
    const companion = await this.ownCompanion(userId);
    const module = TRAINING_MODULES.find(
      (candidate) => candidate.code === input.moduleCode && candidate.version === input.moduleVersion
    );
    if (!module) {
      throw new AppException("TRAINING_MODULE_NOT_FOUND", "Training module not found", HttpStatus.NOT_FOUND);
    }
    if (input.answers.length !== module.questions.length) {
      throw new AppException(
        "TRAINING_ANSWERS_INCOMPLETE",
        "Every training question must be answered",
        HttpStatus.BAD_REQUEST,
        { expected: module.questions.length }
      );
    }
    const correct = module.questions.reduce(
      (total, question, index) => total + (input.answers[index] === question.answer ? 1 : 0),
      0
    );
    const score = Math.round((correct / module.questions.length) * 100);
    const passed = score >= module.passScore;
    const now = new Date();
    const expiresAt = passed ? new Date(now.getTime() + module.validityDays * 24 * 60 * 60_000) : null;
    const record = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`talk-and-talk:training:${companion.id}:${module.code}`}))::text AS "lock"
      `;
      const existing = await db.companionTrainingRecord.findUnique({
        where: {
          companionId_moduleCode_moduleVersion: {
            companionId: companion.id,
            moduleCode: module.code,
            moduleVersion: module.version
          }
        }
      });
      const updated = await db.companionTrainingRecord.upsert({
        where: {
          companionId_moduleCode_moduleVersion: {
            companionId: companion.id,
            moduleCode: module.code,
            moduleVersion: module.version
          }
        },
        create: {
          companionId: companion.id,
          moduleCode: module.code,
          moduleVersion: module.version,
          status: passed ? "passed" : "inProgress",
          attemptCount: 1,
          bestScore: score,
          lastAttemptedAt: now,
          passedAt: passed ? now : null,
          expiresAt
        },
        update: {
          status: passed ? "passed" : existing?.status === "passed" ? "passed" : "inProgress",
          attemptCount: { increment: 1 },
          bestScore: Math.max(existing?.bestScore ?? 0, score),
          lastAttemptedAt: now,
          ...(passed ? { passedAt: now, expiresAt } : {})
        }
      });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: [userId],
        action: "commercial.companion_training_attempted",
        resourceType: "companionTrainingRecord",
        resourceId: updated.id,
        metadata: {
          companionId: companion.id,
          moduleCode: module.code,
          moduleVersion: module.version,
          score,
          passed
        }
      }, db);
      return updated;
    });
    return {
      moduleCode: module.code,
      moduleVersion: module.version,
      score,
      passScore: module.passScore,
      passed,
      record: this.trainingRecordDto(record)
    };
  }

  async quality(userId: string) {
    const companion = await this.ownCompanion(userId);
    return this.qualityForCompanion(companion.id);
  }

  async actions(userId: string, active?: boolean, page = 1, pageSize = 50, actionId?: string) {
    const companion = await this.ownCompanion(userId);
    return this.actionsForCompanion(companion.id, active, page, pageSize, actionId);
  }

  async appeal(userId: string, actionId: string, input: CreateCompanionAppealDto) {
    this.caseEvidence.assertAttachmentsAllowed(input.evidenceAssetIds);
    const companion = await this.ownCompanion(userId);
    const responseHours = this.config.get<number>("COMPANION_APPEAL_RESPONSE_HOURS") ?? 72;
    try {
      const appeal = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companion.id} FOR UPDATE`;
        const currentCompanion = await db.companionProfile.findUnique({
          where: { id: companion.id },
          select: { id: true, ownerUserId: true }
        });
        if (!currentCompanion || currentCompanion.ownerUserId !== userId) {
          throw new AppException("COMPANION_PROFILE_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
        }
        await db.$queryRaw`SELECT "id" FROM "CompanionAccountAction" WHERE "id" = ${actionId} FOR UPDATE`;
        const action = await db.companionAccountAction.findFirst({
          where: { id: actionId, companionId: companion.id }
        });
        if (!action) {
          throw new AppException("COMPANION_ACTION_NOT_FOUND", "Account action not found", HttpStatus.NOT_FOUND);
        }
        if (action.revokedAt) {
          throw new AppException(
            "COMPANION_ACTION_ALREADY_REVOKED",
            "A revoked account action no longer requires an appeal",
            HttpStatus.CONFLICT
          );
        }
        const now = new Date();
        if (action.endsAt instanceof Date && action.endsAt.getTime() <= now.getTime()) {
          throw new AppException(
            "COMPANION_ACTION_ALREADY_ENDED",
            "An expired temporary account action follows the reactivation workflow instead of a new appeal",
            HttpStatus.CONFLICT,
            { endsAt: action.endsAt.toISOString() }
          );
        }
        if (action.appealDeadlineAt.getTime() <= now.getTime()) {
          throw new AppException(
            "COMPANION_ACTION_APPEAL_WINDOW_CLOSED",
            "The appeal submission window has closed",
            HttpStatus.CONFLICT,
            { appealDeadlineAt: action.appealDeadlineAt.toISOString() }
          );
        }
        const duplicate = await db.companionAccountAppeal.findUnique({
          where: {
            actionId_companionId: {
              actionId: action.id,
              companionId: companion.id
            }
          },
          select: { id: true }
        });
        if (duplicate) {
          throw new AppException(
            "COMPANION_ACTION_APPEAL_EXISTS",
            "An appeal already exists for this account action",
            HttpStatus.CONFLICT
          );
        }
        const created = await db.companionAccountAppeal.create({
          data: {
            actionId: action.id,
            companionId: companion.id,
            statement: input.statement.trim(),
            reviewDueAt: new Date(now.getTime() + responseHours * 60 * 60_000)
          }
        });
        await this.caseEvidence.bindCompanionAccountAppeal(db, {
          assetIds: input.evidenceAssetIds,
          userId,
          actionId: action.id,
          appealId: created.id
        });
        await this.notifications.createTransactional(db, {
          userId,
          type: "supportUpdate",
          title: "陪伴者账号处置申诉已提交",
          body: "平台已受理，将由非原处置人员独立复核。",
          data: {
            route: "companionDevelopment",
            actionId: action.id,
            appealId: created.id,
            reviewDueAt: created.reviewDueAt.toISOString()
          },
          eventKey: `companion-account-appeal:${created.id}:submitted:${userId}`,
          templateKey: "supportUpdate"
        });
        await this.audit.record({
          actorId: userId,
          subjectUserIds: [userId],
          action: "commercial.companion_action_appealed",
          resourceType: "companionAccountAction",
          resourceId: action.id,
          metadata: {
            companionId: companion.id,
            appealId: created.id,
            evidenceCount: input.evidenceAssetIds?.length ?? 0,
            appealDeadlineAt: action.appealDeadlineAt.toISOString(),
            reviewDueAt: created.reviewDueAt.toISOString()
          }
        }, db);
        return db.companionAccountAppeal.findUniqueOrThrow({
          where: { id: created.id },
          include: this.caseEvidence.attachmentInclude()
        });
      });
      return this.appealDto(appeal);
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new AppException(
          "COMPANION_ACTION_APPEAL_EXISTS",
          "An appeal already exists for this account action",
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  async incidents(userId: string, status?: string, page = 1, pageSize = 50) {
    const companion = await this.ownCompanion(userId);
    return this.incidentsForCompanion(companion.id, status, page, pageSize);
  }

  async createIncident(userId: string, input: CreateCompanionIncidentDto) {
    // Do this before even resolving the owner profile: a text-only release
    // cannot create an incident row or audit event for a media-bearing request.
    this.caseEvidence.assertAttachmentsAllowed(input.evidenceAssetIds);
    const companion = await this.ownCompanion(userId);
    const incident = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      if (input.orderId) {
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
        const order = await db.order.findFirst({
          where: { id: input.orderId, companionId: companion.id },
          select: { id: true }
        });
        if (!order) {
          throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
        }
      }
      const created = await db.companionIncidentReport.create({
        data: {
          companionId: companion.id,
          orderId: input.orderId ?? null,
          category: input.category,
          summary: input.summary.trim()
        }
      });
      await this.caseEvidence.bindCompanionIncident(db, {
        assetIds: input.evidenceAssetIds,
        userId,
        companionId: companion.id,
        incidentId: created.id
      });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: [userId],
        action: "commercial.companion_incident_created",
        resourceType: "companionIncidentReport",
        resourceId: created.id,
        metadata: {
          companionId: companion.id,
          orderId: input.orderId ?? null,
          category: input.category,
          evidenceCount: input.evidenceAssetIds?.length ?? 0
        }
      }, db);
      return db.companionIncidentReport.findUniqueOrThrow({
        where: { id: created.id },
        include: this.caseEvidence.attachmentInclude()
      });
    });
    return this.incidentDto(incident);
  }

  async withdrawals(userId: string, status?: string, page = 1, pageSize = 50) {
    const companion = await this.ownCompanion(userId);
    return this.withdrawalsForCompanion(companion.id, status, page, pageSize);
  }

  async requestWithdrawal(userId: string, input: CreateWithdrawalRequestDto) {
    const companion = await this.ownCompanion(userId);
    const earningIds = [...new Set(input.earningIds)];
    const request = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`talk-and-talk:withdrawal:${companion.id}`}))::text AS "lock"
      `;
      const commercialProfile = await db.companionCommercialProfile.findUnique({
        where: { companionId: companion.id }
      });
      if (commercialProfile?.status !== "verified") {
        throw new AppException(
          "COMPANION_COMMERCIAL_PROFILE_NOT_VERIFIED",
          "A verified commercial profile is required before requesting settlement",
          HttpStatus.CONFLICT
        );
      }
      if (
        commercialProfile.adultEligibilityVerdict !== "adult"
        || !(commercialProfile.adultEligibilityValidUntil instanceof Date)
        || commercialProfile.adultEligibilityValidUntil.getTime() <= Date.now()
      ) {
        throw new AppException(
          "COMPANION_ADULT_ELIGIBILITY_NOT_CURRENT",
          "Current adult eligibility is required before requesting settlement",
          HttpStatus.CONFLICT
        );
      }
      const duplicate = await db.companionWithdrawalRequest.findFirst({
        where: {
          companionId: companion.id,
          status: { in: [...ACTIVE_WITHDRAWAL_STATUSES] },
          earningIds: { hasSome: earningIds }
        },
        select: { id: true }
      });
      if (duplicate) {
        throw new AppException(
          "WITHDRAWAL_EARNING_ALREADY_REQUESTED",
          "One or more earnings already belong to an active withdrawal request",
          HttpStatus.CONFLICT,
          { requestId: duplicate.id }
        );
      }
      const earnings = await db.companionEarning.findMany({
        where: { id: { in: earningIds }, companionId: companion.id, status: "available" },
        select: { id: true, payableCents: true }
      });
      if (earnings.length !== earningIds.length) {
        throw new AppException(
          "WITHDRAWAL_EARNING_NOT_AVAILABLE",
          "Every selected earning must belong to this companion and remain available",
          HttpStatus.CONFLICT
        );
      }
      const amountCents = earnings.reduce((total: number, earning: any) => total + earning.payableCents, 0);
      const created = await db.companionWithdrawalRequest.create({
        data: {
          companionId: companion.id,
          earningIds,
          amountCents,
          settlementRecipientMasked: commercialProfile.settlementRecipientMasked
        }
      });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: [userId],
        action: "commercial.companion_withdrawal_requested",
        resourceType: "companionWithdrawalRequest",
        resourceId: created.id,
        metadata: { companionId: companion.id, earningIds, amountCents }
      }, db);
      return created;
    });
    return this.withdrawalDto(request);
  }

  async cancelWithdrawal(userId: string, requestId: string) {
    const companion = await this.ownCompanion(userId);
    const request = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionWithdrawalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
      const existing = await db.companionWithdrawalRequest.findFirst({
        where: { id: requestId, companionId: companion.id }
      });
      if (!existing) {
        throw new AppException("WITHDRAWAL_REQUEST_NOT_FOUND", "Withdrawal request not found", HttpStatus.NOT_FOUND);
      }
      if (existing.status !== "requested") {
        throw new AppException(
          "WITHDRAWAL_REQUEST_NOT_CANCELLABLE",
          "Only a newly requested withdrawal can be cancelled",
          HttpStatus.CONFLICT
        );
      }
      const updated = await db.companionWithdrawalRequest.update({
        where: { id: existing.id },
        data: { status: "cancelled" }
      });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: [userId],
        action: "commercial.companion_withdrawal_cancelled",
        resourceType: "companionWithdrawalRequest",
        resourceId: existing.id,
        metadata: { companionId: companion.id }
      }, db);
      return updated;
    });
    return this.withdrawalDto(request);
  }

  async createAccountAction(actorId: string, input: CreateCompanionAccountActionDto) {
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    if (endsAt && endsAt.getTime() <= Date.now()) {
      throw new AppException("COMPANION_ACTION_END_INVALID", "Action end time must be in the future", HttpStatus.BAD_REQUEST);
    }
    const appealSubmissionDays =
      this.config.get<number>("COMPANION_APPEAL_SUBMISSION_DAYS") ?? 30;
    const appealDeadlineAt = new Date(
      Date.now() + appealSubmissionDays * 24 * 60 * 60_000
    );
    const action = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${input.companionId} FOR UPDATE`;
      const companion = await db.companionProfile.findUnique({ where: { id: input.companionId } });
      if (!companion) {
        throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
      }
      const created = await db.companionAccountAction.create({
        data: {
          companionId: companion.id,
          kind: input.kind,
          reasonCode: input.reasonCode.trim(),
          message: input.message.trim(),
          endsAt,
          appealDeadlineAt,
          createdById: actorId
        }
      });
      if (input.kind === "serviceRestriction" || input.kind === "suspension") {
        await db.companionProfile.update({
          where: { id: companion.id },
          data: { isPublished: false, availability: "busy", isOnline: false }
        });
      }
      if (input.kind === "suspension") {
        await db.companionCommercialProfile.updateMany({
          where: { companionId: companion.id },
          data: {
            status: "suspended",
            suspendedAt: new Date(),
            suspendedById: actorId,
            suspendedReason: input.message.trim(),
            suspendedByAccountActionId: created.id
          }
        });
      }
      await this.audit.record({
        actorId,
        subjectUserIds: companion.ownerUserId ? [companion.ownerUserId] : [],
        action: "commercial.companion_account_action_created",
        resourceType: "companionAccountAction",
        resourceId: created.id,
        metadata: {
          companionId: companion.id,
          kind: input.kind,
          reasonCode: input.reasonCode.trim(),
          endsAt: endsAt?.toISOString() ?? null,
          appealDeadlineAt: appealDeadlineAt.toISOString()
        }
      }, db);
      if (companion.ownerUserId) {
        await this.notifications.createTransactional(db, {
          userId: companion.ownerUserId,
          type: "safetyAlert",
          title: input.kind === "warning"
            ? "陪伴者账号收到平台提醒"
            : input.kind === "serviceRestriction"
              ? "陪伴者服务资格已受限"
              : "陪伴者服务资格已暂停",
          body: created.message,
          data: {
            route: "companionDevelopment",
            actionId: created.id,
            actionKind: created.kind,
            reasonCode: created.reasonCode,
            appealDeadlineAt: created.appealDeadlineAt.toISOString()
          },
          eventKey: `companion-account-action:${created.id}:created:${companion.ownerUserId}`,
          templateKey: "supportUpdate"
        });
      }
      return created;
    });
    return this.actionDto(action);
  }

  async materializeExpiredSuspensionReactivations(
    batchSize = 50,
    now = new Date()
  ): Promise<{ scanned: number; materialized: number; hasMore: boolean }> {
    const boundedBatchSize = Math.min(200, Math.max(1, Math.floor(batchSize)));
    const transitioned = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const rows = await db.$queryRaw<Array<{
        id: string;
        companionId: string;
        endsAt: Date;
        ownerUserId: string | null;
      }>>`
        WITH candidates AS MATERIALIZED (
          SELECT action."id"
          FROM "CompanionAccountAction" AS action
          WHERE action."kind" = 'suspension'
            AND action."revokedAt" IS NULL
            AND action."endsAt" <= ${now}
            AND action."reactivationStatus" = 'notRequired'
            AND NOT EXISTS (
              SELECT 1 FROM "CompanionAccountAppeal" AS appeal
              WHERE appeal."actionId" = action."id"
                AND appeal."status" = 'pending'
            )
          ORDER BY action."endsAt", action."id"
          FOR UPDATE OF action SKIP LOCKED
          LIMIT ${boundedBatchSize}
        ), updated AS (
          UPDATE "CompanionAccountAction" AS action
          SET
            "reactivationStatus" = 'required',
            "reactivationRequiredAt" = ${now},
            "updatedAt" = CURRENT_TIMESTAMP
          FROM candidates
          WHERE action."id" = candidates."id"
            AND action."revokedAt" IS NULL
            AND action."reactivationStatus" = 'notRequired'
            AND action."endsAt" <= ${now}
          RETURNING action."id", action."companionId", action."endsAt"
        )
        SELECT updated."id", updated."companionId", updated."endsAt",
               companion."ownerUserId"
        FROM updated
        JOIN "CompanionProfile" AS companion ON companion."id" = updated."companionId"
        ORDER BY updated."endsAt", updated."id"
      `;
      for (const action of rows) {
        if (!action.ownerUserId) {
          throw new Error("Expired companion suspension has no owner for reactivation notice");
        }
        await this.audit.record({
          actorId: "system",
          subjectUserIds: [action.ownerUserId],
          action: "commercial.companion_suspension_expiry_reactivation_required",
          resourceType: "companionAccountAction",
          resourceId: action.id,
          metadata: {
            companionId: action.companionId,
            endsAt: action.endsAt.toISOString(),
            publicationRestored: false
          }
        }, db);
        await this.notifications.createTransactional(db, {
          userId: action.ownerUserId,
          type: "supportUpdate",
          title: "陪伴者临时暂停已到期，资格恢复待复核",
          body: "暂停期限已经结束；平台不会自动恢复商业资格或公开上架，须由另一名运营人员复核当前资格。",
          data: {
            route: "companionDevelopment",
            actionId: action.id,
            reactivationStatus: "required",
            publicationRestored: false
          },
          eventKey: `companion-account-action:${action.id}:expiry-reactivation-required:${action.ownerUserId}`,
          templateKey: "supportUpdate"
        });
      }
      return rows;
    });
    return {
      scanned: transitioned.length,
      materialized: transitioned.length,
      hasMore: transitioned.length === boundedBatchSize
    };
  }

  async completeExpiredSuspensionReactivation(
    actorId: string,
    actionId: string,
    input: CompleteCompanionReactivationDto
  ) {
    const resolution = input.resolution.trim();
    const pointer: any = await this.prisma.companionAccountAction.findUnique({
      where: { id: actionId },
      select: {
        companionId: true,
        companion: { select: { ownerUserId: true } }
      }
    } as any);
    if (!pointer) {
      throw new AppException("COMPANION_ACTION_NOT_FOUND", "Account action not found", HttpStatus.NOT_FOUND);
    }
    const pointerOwnerUserId = pointer.companion?.ownerUserId;
    if (!pointerOwnerUserId) {
      throw new AppException(
        "COMPANION_REACTIVATION_OWNER_UNAVAILABLE",
        "The companion has no current owner account for reactivation review",
        HttpStatus.CONFLICT
      );
    }
    const action = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${pointerOwnerUserId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${pointer.companionId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "CompanionAccountAction" WHERE "id" = ${actionId} FOR UPDATE`;
      const existing = await db.companionAccountAction.findUnique({
        where: { id: actionId },
        include: {
          companion: {
            include: {
              owner: { include: { profile: true } },
              commercialProfile: true
            }
          }
        }
      });
      if (!existing) {
        throw new AppException("COMPANION_ACTION_NOT_FOUND", "Account action not found", HttpStatus.NOT_FOUND);
      }
      const ownerUserId = existing.companion?.ownerUserId;
      if (ownerUserId !== pointerOwnerUserId || existing.companionId !== pointer.companionId) {
        throw new AppException(
          "COMPANION_REACTIVATION_OWNER_CHANGED",
          "The companion owner changed while reactivation was being reviewed",
          HttpStatus.CONFLICT
        );
      }
      const now = new Date();
      this.assertExpiredSuspensionReactivationState(existing, actorId, now);

      const competingAction = await db.companionAccountAction.findFirst({
        where: {
          companionId: existing.companionId,
          id: { not: existing.id },
          kind: { in: ["serviceRestriction", "suspension"] },
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }]
        },
        select: { id: true, kind: true }
      });
      if (competingAction) {
        throw new AppException(
          "COMPANION_REACTIVATION_OTHER_ACTION_ACTIVE",
          "Another active account restriction must be resolved before reactivation",
          HttpStatus.CONFLICT,
          { actionKind: competingAction.kind }
        );
      }

      const companion = existing.companion;
      const owner = companion?.owner;
      const profile = companion?.commercialProfile;
      if (
        !companion?.isVerified
        || !owner
        || !["user", "companion"].includes(owner.role)
        || owner.accountStatus !== "active"
        || owner.profile?.isVerified !== true
      ) {
        throw new AppException(
          "COMPANION_REACTIVATION_OWNER_NOT_ELIGIBLE",
          "The companion and current owner must remain active and identity-verified",
          HttpStatus.CONFLICT
        );
      }
      const activeDeletion = await db.accountDeletionRequest.findFirst({
        where: {
          userId: ownerUserId,
          status: { in: ["pending", "processing", "completed"] }
        },
        select: { id: true, status: true }
      });
      if (activeDeletion) {
        throw new AppException(
          "COMPANION_REACTIVATION_ACCOUNT_DELETION_ACTIVE",
          "Reactivation is unavailable while account deletion is pending, processing, or completed",
          HttpStatus.CONFLICT,
          { deletionStatus: activeDeletion.status }
        );
      }
      if (!Number.isInteger(owner.profile.age) || owner.profile.age < 18) {
        throw new AppException(
          "COMPANION_REACTIVATION_ADULT_ELIGIBILITY_REQUIRED",
          "Current adult eligibility is required before reactivation",
          HttpStatus.CONFLICT
        );
      }
      if (
        !profile
        || !["suspended", "verified"].includes(profile.status)
        || profile.adultEligibilityVerdict !== "adult"
        || !(profile.adultEligibilityVerifiedAt instanceof Date)
        || !(profile.adultEligibilityValidUntil instanceof Date)
        || profile.adultEligibilityValidUntil.getTime() <= now.getTime()
        || !(profile.nextReviewDueAt instanceof Date)
        || profile.nextReviewDueAt.getTime() <= now.getTime()
      ) {
        throw new AppException(
          "COMPANION_REACTIVATION_COMMERCIAL_REVIEW_REQUIRED",
          "Current commercial evidence, adult eligibility and scheduled review must pass before reactivation",
          HttpStatus.CONFLICT
        );
      }
      const suspensionCausedByAction = profile.status === "suspended"
        && profile.suspendedByAccountActionId === existing.id;
      const independentlyReverified = profile.status === "verified"
        && profile.suspendedByAccountActionId == null;
      if (!suspensionCausedByAction && !independentlyReverified) {
        throw new AppException(
          "COMPANION_REACTIVATION_SUSPENSION_SOURCE_MISMATCH",
          "The current commercial suspension is not provably caused by this expired action; resubmit and independently verify the commercial profile first",
          HttpStatus.CONFLICT
        );
      }

      const trainingRecords = await db.companionTrainingRecord.findMany({
        where: {
          companionId: existing.companionId,
          status: "passed",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        },
        select: { moduleCode: true, moduleVersion: true }
      });
      const currentTraining = new Set(
        trainingRecords.map((record: any) => `${record.moduleCode}:${record.moduleVersion}`)
      );
      const missingTraining = TRAINING_MODULES.filter(
        (module) => !currentTraining.has(`${module.code}:${module.version}`)
      ).map((module) => module.code);
      if (missingTraining.length) {
        throw new AppException(
          "COMPANION_REACTIVATION_TRAINING_REQUIRED",
          "Every required training module must remain current before reactivation",
          HttpStatus.CONFLICT,
          { missingModuleCodes: missingTraining }
        );
      }

      if (suspensionCausedByAction) {
        await db.companionCommercialProfile.update({
          where: { companionId: existing.companionId },
          data: {
            status: "verified",
            suspendedAt: null,
            suspendedById: null,
            suspendedReason: null,
            suspendedByAccountActionId: null
          }
        });
      }
      await db.companionProfile.update({
        where: { id: existing.companionId },
        data: { isPublished: false, isOnline: false, availability: "busy" }
      });
      const updated = await db.companionAccountAction.update({
        where: { id: existing.id },
        data: {
          reactivationStatus: "completed",
          reactivationCompletedAt: now,
          reactivationCompletedById: actorId,
          reactivationResolution: resolution
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [ownerUserId],
        action: "commercial.companion_action_reactivation_completed",
        resourceType: "companionAccountAction",
        resourceId: existing.id,
        metadata: {
          companionId: existing.companionId,
          actionKind: existing.kind,
          originalActionCreatedById: existing.createdById,
          independentReactivationReview: true,
          commercialProfileRestored: suspensionCausedByAction,
          publicationRestored: false
        }
      }, db);
      await this.notifications.createTransactional(db, {
        userId: ownerUserId,
        type: "supportUpdate",
        title: "陪伴者临时暂停恢复复核已完成",
        body: "当前资格复核已完成；平台未自动恢复公开上架，公开状态仍须由运营另行确认。",
        data: {
          route: "companionDevelopment",
          actionId: existing.id,
          reactivationStatus: "completed",
          publicationRestored: false
        },
        eventKey: `companion-account-action:${existing.id}:reactivation-completed:${ownerUserId}`,
        templateKey: "supportUpdate"
      });
      return updated;
    });
    return this.actionDto(action);
  }

  async resolveAppeal(actorId: string, appealId: string, input: ResolveCompanionAppealDto) {
    const appeal = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await lockStaffCredentialRowsInOrder(db, [actorId]);
      await this.assertCompanionAppealStaff(db, actorId, ["supply", "admin"]);
      await db.$queryRaw`SELECT "id" FROM "CompanionAccountAppeal" WHERE "id" = ${appealId} FOR UPDATE`;
      const existing = await db.companionAccountAppeal.findUnique({
        where: { id: appealId },
        include: {
          action: true,
          companion: { select: { ownerUserId: true } },
          ...this.caseEvidence.attachmentInclude()
        }
      });
      if (!existing) {
        throw new AppException("COMPANION_APPEAL_NOT_FOUND", "Appeal not found", HttpStatus.NOT_FOUND);
      }
      if (existing.status !== "pending") {
        throw new AppException("COMPANION_APPEAL_ALREADY_RESOLVED", "Appeal is already resolved", HttpStatus.CONFLICT);
      }
      if (!existing.action?.createdById || existing.action.createdById === actorId) {
        throw new AppException(
          "COMPANION_APPEAL_INDEPENDENT_REVIEW_REQUIRED",
          "The staff member who created the original account action cannot resolve its appeal",
          HttpStatus.CONFLICT
        );
      }
      if (existing.assignedToUserId !== actorId) {
        throw new AppException(
          "COMPANION_APPEAL_ASSIGNEE_REQUIRED",
          "Claim or receive assignment before resolving this appeal",
          HttpStatus.FORBIDDEN
        );
      }
      const now = new Date();
      const reactivationRequired = input.status === "overturned"
        && ["serviceRestriction", "suspension"].includes(existing.action.kind);
      const updated = await db.companionAccountAppeal.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          resolution: input.resolution.trim(),
          resolvedAt: now,
          resolvedById: actorId,
          reactivationStatus: reactivationRequired ? "required" : "notRequired",
          reactivationRequiredAt: reactivationRequired ? now : null,
          reactivationCompletedAt: null,
          reactivationCompletedById: null,
          reactivationResolution: null
        }
      });
      if (input.status === "overturned") {
        await db.companionAccountAction.update({
          where: { id: existing.actionId },
          data: {
            revokedAt: now,
            revokedById: actorId,
            ...(existing.action.reactivationStatus === "required"
              ? {
                  reactivationStatus: "completed",
                  reactivationCompletedAt: now,
                  reactivationCompletedById: actorId,
                  reactivationResolution: `Superseded by overturned appeal ${existing.id}`
                }
              : {})
          }
        });
      }
      await this.audit.record({
        actorId,
        subjectUserIds: existing.companion?.ownerUserId
          ? [existing.companion.ownerUserId]
          : [],
        action: "commercial.companion_action_appeal_resolved",
        resourceType: "companionAccountAppeal",
        resourceId: existing.id,
        metadata: {
          companionId: existing.companionId,
          actionId: existing.actionId,
          status: input.status,
          originalActionCreatedById: existing.action.createdById,
          independentReview: true,
          reactivationRequired,
          publicationRestored: false
        }
      }, db);
      if (existing.companion?.ownerUserId) {
        await this.notifications.createTransactional(db, {
          userId: existing.companion.ownerUserId,
          type: "supportUpdate",
          title: reactivationRequired
            ? "陪伴者申诉已撤销原处置，恢复待复核"
            : input.status === "overturned"
              ? "陪伴者申诉已撤销原处置"
            : "陪伴者申诉已有结果",
          body: reactivationRequired
            ? "原账号处置已撤销；平台不会自动恢复商业资格或公开上架，须由另一名运营人员完成当前资格复核。"
            : input.resolution.trim(),
          data: {
            route: "companionDevelopment",
            actionId: existing.actionId,
            appealId: existing.id,
            appealStatus: input.status,
            reactivationStatus: reactivationRequired ? "required" : "notRequired",
            publicationRestored: false
          },
          eventKey: `companion-account-appeal:${existing.id}:resolved:${input.status}:${existing.companion.ownerUserId}`,
          templateKey: "supportUpdate"
        });
      }
      return { ...updated, evidenceAttachments: existing.evidenceAttachments };
    });
    return this.appealDto(appeal);
  }

  async completeAppealReactivation(
    actorId: string,
    appealId: string,
    input: CompleteCompanionReactivationDto
  ) {
    const resolution = input.resolution.trim();
    const appeal = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionAccountAppeal" WHERE "id" = ${appealId} FOR UPDATE`;
      let existing = await db.companionAccountAppeal.findUnique({
        where: { id: appealId },
        include: {
          action: true,
          companion: { select: { id: true, ownerUserId: true } },
          ...this.caseEvidence.attachmentInclude()
        }
      });
      if (!existing) {
        throw new AppException("COMPANION_APPEAL_NOT_FOUND", "Appeal not found", HttpStatus.NOT_FOUND);
      }
      this.assertReactivationReviewState(existing, actorId);
      const ownerUserId = existing.companion?.ownerUserId;
      if (!ownerUserId) {
        throw new AppException(
          "COMPANION_REACTIVATION_OWNER_UNAVAILABLE",
          "The companion has no current owner account for reactivation review",
          HttpStatus.CONFLICT
        );
      }

      // Publication uses User -> CompanionProfile. Keep the same order so a
      // reactivation review cannot deadlock a simultaneous explicit publish.
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerUserId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${existing.companionId} FOR UPDATE`;
      existing = await db.companionAccountAppeal.findUnique({
        where: { id: appealId },
        include: {
          action: true,
          companion: {
            include: {
              owner: { include: { profile: true } },
              commercialProfile: true
            }
          },
          ...this.caseEvidence.attachmentInclude()
        }
      });
      if (!existing) {
        throw new AppException("COMPANION_APPEAL_NOT_FOUND", "Appeal not found", HttpStatus.NOT_FOUND);
      }
      this.assertReactivationReviewState(existing, actorId);

      const now = new Date();
      const competingAction = await db.companionAccountAction.findFirst({
        where: {
          companionId: existing.companionId,
          id: { not: existing.actionId },
          kind: { in: ["serviceRestriction", "suspension"] },
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }]
        },
        select: { id: true, kind: true }
      });
      if (competingAction) {
        throw new AppException(
          "COMPANION_REACTIVATION_OTHER_ACTION_ACTIVE",
          "Another active account restriction must be resolved before reactivation",
          HttpStatus.CONFLICT,
          { actionKind: competingAction.kind }
        );
      }

      const companion = existing.companion;
      const owner = companion?.owner;
      const profile = companion?.commercialProfile;
      if (
        !companion?.isVerified
        || !owner
        || !["user", "companion"].includes(owner.role)
        || owner.accountStatus !== "active"
        || owner.profile?.isVerified !== true
      ) {
        throw new AppException(
          "COMPANION_REACTIVATION_OWNER_NOT_ELIGIBLE",
          "The companion and current owner must remain active and identity-verified",
          HttpStatus.CONFLICT
        );
      }
      const activeDeletion = await db.accountDeletionRequest.findFirst({
        where: {
          userId: ownerUserId,
          status: { in: ["pending", "processing", "completed"] }
        },
        select: { id: true, status: true }
      });
      if (activeDeletion) {
        throw new AppException(
          "COMPANION_REACTIVATION_ACCOUNT_DELETION_ACTIVE",
          "Reactivation is unavailable while account deletion is pending, processing, or completed",
          HttpStatus.CONFLICT,
          { deletionStatus: activeDeletion.status }
        );
      }
      if (!Number.isInteger(owner.profile.age) || owner.profile.age < 18) {
        throw new AppException(
          "COMPANION_REACTIVATION_ADULT_ELIGIBILITY_REQUIRED",
          "Current adult eligibility is required before reactivation",
          HttpStatus.CONFLICT
        );
      }
      if (!profile) {
        throw new AppException(
          "COMPANION_REACTIVATION_COMMERCIAL_PROFILE_MISSING",
          "The commercial profile must be reviewed before reactivation",
          HttpStatus.CONFLICT
        );
      }
      const expectedProfileStatus = existing.action.kind === "suspension" ? "suspended" : "verified";
      if (
        profile.status !== expectedProfileStatus
        || profile.adultEligibilityVerdict !== "adult"
        || !(profile.adultEligibilityVerifiedAt instanceof Date)
        || !(profile.adultEligibilityValidUntil instanceof Date)
        || profile.adultEligibilityValidUntil.getTime() <= now.getTime()
        || !(profile.nextReviewDueAt instanceof Date)
        || profile.nextReviewDueAt.getTime() <= now.getTime()
      ) {
        throw new AppException(
          "COMPANION_REACTIVATION_COMMERCIAL_REVIEW_REQUIRED",
          "Current commercial evidence, adult eligibility and scheduled review must pass before reactivation",
          HttpStatus.CONFLICT,
          { expectedProfileStatus }
        );
      }
      if (
        existing.action.kind === "suspension"
        && profile.suspendedByAccountActionId !== existing.actionId
      ) {
        throw new AppException(
          "COMPANION_REACTIVATION_SUSPENSION_SOURCE_MISMATCH",
          "The current commercial suspension is not provably caused by this overturned action",
          HttpStatus.CONFLICT
        );
      }

      const trainingRecords = await db.companionTrainingRecord.findMany({
        where: {
          companionId: existing.companionId,
          status: "passed",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        },
        select: { moduleCode: true, moduleVersion: true }
      });
      const currentTraining = new Set(
        trainingRecords.map((record: any) => `${record.moduleCode}:${record.moduleVersion}`)
      );
      const missingTraining = TRAINING_MODULES.filter(
        (module) => !currentTraining.has(`${module.code}:${module.version}`)
      ).map((module) => module.code);
      if (missingTraining.length) {
        throw new AppException(
          "COMPANION_REACTIVATION_TRAINING_REQUIRED",
          "Every required training module must remain current before reactivation",
          HttpStatus.CONFLICT,
          { missingModuleCodes: missingTraining }
        );
      }

      if (existing.action.kind === "suspension") {
        await db.companionCommercialProfile.update({
          where: { companionId: existing.companionId },
          data: {
            status: "verified",
            suspendedAt: null,
            suspendedById: null,
            suspendedReason: null,
            suspendedByAccountActionId: null
          }
        });
      }
      // Revoking a restriction does not prove that the profile was public before
      // it. Keep every public/online signal fail-closed until a separate publish.
      await db.companionProfile.update({
        where: { id: existing.companionId },
        data: { isPublished: false, isOnline: false, availability: "busy" }
      });
      const updated = await db.companionAccountAppeal.update({
        where: { id: existing.id },
        data: {
          reactivationStatus: "completed",
          reactivationCompletedAt: now,
          reactivationCompletedById: actorId,
          reactivationResolution: resolution
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [ownerUserId],
        action: "commercial.companion_action_reactivation_completed",
        resourceType: "companionAccountAppeal",
        resourceId: existing.id,
        metadata: {
          companionId: existing.companionId,
          actionId: existing.actionId,
          actionKind: existing.action.kind,
          originalActionCreatedById: existing.action.createdById,
          appealResolvedById: existing.resolvedById,
          independentReactivationReview: true,
          commercialProfileRestored: existing.action.kind === "suspension",
          publicationRestored: false
        }
      }, db);
      await this.notifications.createTransactional(db, {
        userId: ownerUserId,
        type: "supportUpdate",
        title: "陪伴者资格恢复复核已完成",
        body: "当前资格复核已完成；平台未自动恢复公开上架，公开状态仍须由运营另行确认。",
        data: {
          route: "companionDevelopment",
          actionId: existing.actionId,
          appealId: existing.id,
          appealStatus: "overturned",
          reactivationStatus: "completed",
          publicationRestored: false
        },
        eventKey: `companion-account-appeal:${existing.id}:reactivation-completed:${ownerUserId}`,
        templateKey: "supportUpdate"
      });
      return { ...updated, evidenceAttachments: existing.evidenceAttachments };
    });
    return this.appealDto(appeal);
  }

  async createVoiceIntroReadUrl(actorId: string, companionId: string) {
    this.assertVoiceIntroEnabled();
    const companion = await this.prisma.companionProfile.findUnique({
      where: { id: companionId },
      select: {
        id: true,
        voiceIntroAssetRef: true,
        voiceIntroDurationSeconds: true,
        voiceIntroStatus: true,
        ownerUserId: true
      }
    } as any);
    if (!companion?.voiceIntroAssetRef || !companion.voiceIntroDurationSeconds) {
      throw new AppException("VOICE_INTRO_NOT_FOUND", "Voice introduction submission not found", HttpStatus.NOT_FOUND);
    }
    if (companion.voiceIntroStatus !== "pendingReview") {
      throw new AppException(
        "VOICE_INTRO_INVALID_STATE",
        "Voice introduction is not awaiting review",
        HttpStatus.CONFLICT
      );
    }

    const viewer = this.voiceEvidenceViewer();
    const expiresAtUnix = Math.floor(Date.now() / 1_000) + viewer.ttlSeconds;
    const signingPayload = [
      companion.id,
      companion.voiceIntroAssetRef,
      actorId,
      String(expiresAtUnix)
    ].join("\n");
    const signature = createHmac("sha256", viewer.signingSecret)
      .update(signingPayload)
      .digest("hex");
    const assetReferenceHash = this.voiceAssetReferenceHash(companion.voiceIntroAssetRef);
    const url = new URL(viewer.url);
    url.searchParams.set("companionId", companion.id);
    url.searchParams.set("assetReference", companion.voiceIntroAssetRef);
    // The viewer obtains actorId from its authenticated staff session. Keeping
    // it out of the URL avoids leaking an internal identity while the HMAC still
    // binds the link to that exact actor.
    url.searchParams.set("exp", String(expiresAtUnix));
    url.searchParams.set("signature", signature);
    const expiresAt = new Date(expiresAtUnix * 1_000).toISOString();

    await this.audit.record({
      actorId,
      subjectUserIds: companion.ownerUserId ? [companion.ownerUserId] : [],
      action: "commercial.companion_voice_intro_read_issued",
      resourceType: "companionProfile",
      resourceId: companion.id,
      metadata: {
        companionId: companion.id,
        assetReferenceHash,
        expiresAt,
        voiceIntroStatus: companion.voiceIntroStatus
      }
    });

    return {
      url: url.toString(),
      expiresAt,
      assetReferenceHash
    };
  }

  async reviewVoiceIntro(actorId: string, companionId: string, input: ReviewCompanionVoiceIntroDto) {
    this.assertVoiceIntroEnabled();
    if (input.status === "approved") {
      this.voiceEvidenceViewer();
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companionId} FOR UPDATE`;
      const companion = await db.companionProfile.findUnique({ where: { id: companionId } });
      if (!companion?.voiceIntroAssetRef || !companion.voiceIntroDurationSeconds) {
        throw new AppException("VOICE_INTRO_NOT_FOUND", "Voice introduction submission not found", HttpStatus.NOT_FOUND);
      }
      if (companion.voiceIntroStatus !== "pendingReview") {
        throw new AppException(
          "VOICE_INTRO_INVALID_STATE",
          "Voice introduction is not awaiting review",
          HttpStatus.CONFLICT
        );
      }
      if (input.reviewedAssetReference !== companion.voiceIntroAssetRef) {
        throw new AppException(
          "VOICE_INTRO_ASSET_CHANGED",
          "Voice introduction changed after it was loaded; fetch and review the current version",
          HttpStatus.CONFLICT
        );
      }
      const updated = await db.companionProfile.update({
        where: { id: companion.id },
        data: { voiceIntroStatus: input.status }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: companion.ownerUserId ? [companion.ownerUserId] : [],
        action: "commercial.companion_voice_intro_reviewed",
        resourceType: "companionProfile",
        resourceId: companion.id,
        metadata: {
          companionId: companion.id,
          status: input.status,
          durationSeconds: companion.voiceIntroDurationSeconds,
          assetReferenceHash: this.voiceAssetReferenceHash(companion.voiceIntroAssetRef)
        }
      }, db);
      return updated;
    });
    return {
      companionId: result.id,
      status: result.voiceIntroStatus,
      durationSeconds: result.voiceIntroDurationSeconds
    };
  }

  private isVoiceIntroEnabled() {
    return isFirstReleaseCapabilityEnabled("voiceIntro", this.config);
  }

  private assertVoiceIntroEnabled() {
    if (!this.isVoiceIntroEnabled()) {
      throw new AppException(
        "VOICE_INTRO_UNAVAILABLE",
        "Voice introductions are disabled for this release surface",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private voiceEvidenceViewer() {
    const url = this.config.get<string>("COMPANION_VOICE_EVIDENCE_VIEWER_URL")?.trim() ?? "";
    const signingSecret = this.config.get<string>("COMPANION_VOICE_EVIDENCE_SIGNING_SECRET")?.trim() ?? "";
    const ttlSeconds = Number(this.config.get<number>("COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS") ?? 300);
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = url ? new URL(url) : null;
    } catch {
      parsedUrl = null;
    }
    if (
      !parsedUrl
      || parsedUrl.protocol !== "https:"
      || Boolean(parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash)
      || !signingSecret
      || !Number.isSafeInteger(ttlSeconds)
      || ttlSeconds < 60
      || ttlSeconds > 900
    ) {
      throw new AppException(
        "VOICE_INTRO_EVIDENCE_VIEWER_UNAVAILABLE",
        "Controlled voice evidence viewer is unavailable; approval is blocked",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return { url: parsedUrl.toString(), signingSecret, ttlSeconds };
  }

  private voiceAssetReferenceHash(assetReference: string) {
    return createHash("sha256").update(assetReference).digest("hex");
  }

  async claimableAppeals(actorId: string, page = 1, pageSize = 50) {
    await this.assertCompanionAppealStaff(this.prisma as any, actorId, ["supply"]);
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = {
      assignedToUserId: null,
      status: "pending",
      action: { createdById: { not: actorId } }
    };
    const [items, total] = await Promise.all([
      this.prisma.companionAccountAppeal.findMany({
        where,
        select: { id: true, status: true, reviewDueAt: true, createdAt: true },
        orderBy: [{ reviewDueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionAccountAppeal.count({ where } as any)
    ]);
    const now = Date.now();
    return {
      items: items.map((item: any) => ({
        id: item.id,
        status: item.status,
        submittedAt: item.createdAt.toISOString(),
        reviewDueAt: item.reviewDueAt.toISOString(),
        overdue: item.reviewDueAt.getTime() <= now
      })),
      pagination: this.pagination(safePage, safePageSize, total),
      scope: "claimableSummary" as const
    };
  }

  async claimAppeal(actorId: string, appealId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await lockStaffCredentialRowsInOrder(db, [actorId]);
      await this.assertCompanionAppealStaff(db, actorId, ["supply"]);
      await db.$queryRaw`SELECT "id" FROM "CompanionAccountAppeal" WHERE "id" = ${appealId} FOR UPDATE`;
      const existing = await db.companionAccountAppeal.findUnique({
        where: { id: appealId },
        include: this.companionAppealAdminInclude()
      });
      this.assertCompanionAppealReviewable(existing, actorId);
      if (existing.assignedToUserId === actorId) {
        return this.companionAppealStaffDto(existing, actorId);
      }
      if (existing.assignedToUserId) {
        throw new AppException(
          "COMPANION_APPEAL_ALREADY_ASSIGNED",
          "The appeal is already assigned to another operator",
          HttpStatus.CONFLICT
        );
      }
      const assignedAt = new Date();
      const updated = await db.companionAccountAppeal.update({
        where: { id: appealId },
        data: { assignedToUserId: actorId, assignedAt }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [
          existing.companion?.ownerUserId,
          existing.action.createdById
        ].filter((value): value is string => Boolean(value)),
        action: "commercial.companion_action_appeal_claimed",
        resourceType: "companionAccountAppeal",
        resourceId: appealId,
        metadata: {
          companionId: existing.companionId,
          actionId: existing.actionId,
          assignedToUserId: actorId,
          originalActionCreatedById: existing.action.createdById
        }
      }, db);
      return this.companionAppealStaffDto({
        ...existing,
        ...updated,
        assignedTo: null
      }, actorId);
    });
  }

  async assignAppeal(
    actorId: string,
    appealId: string,
    input: AssignCompanionAppealDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await lockStaffCredentialRowsInOrder(db, [actorId, input.assignedToUserId]);
      await this.assertCompanionAppealStaff(db, actorId, ["admin"]);
      await this.assertCompanionAppealStaff(db, input.assignedToUserId, ["supply", "admin"]);
      await db.$queryRaw`SELECT "id" FROM "CompanionAccountAppeal" WHERE "id" = ${appealId} FOR UPDATE`;
      const existing = await db.companionAccountAppeal.findUnique({
        where: { id: appealId },
        include: this.companionAppealAdminInclude()
      });
      this.assertCompanionAppealReviewable(existing, actorId);
      if (existing.action.createdById === input.assignedToUserId) {
        throw new AppException(
          "COMPANION_APPEAL_INDEPENDENT_REVIEW_REQUIRED",
          "The original account-action creator cannot be assigned its appeal",
          HttpStatus.CONFLICT
        );
      }
      if (existing.assignedToUserId === input.assignedToUserId) {
        return this.companionAppealStaffDto(existing, actorId);
      }
      const previousAssignedToUserId = existing.assignedToUserId ?? null;
      const assignedAt = new Date();
      const updated = await db.companionAccountAppeal.update({
        where: { id: appealId },
        data: { assignedToUserId: input.assignedToUserId, assignedAt }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [
          existing.companion?.ownerUserId,
          existing.action.createdById,
          previousAssignedToUserId,
          input.assignedToUserId
        ].filter((value): value is string => Boolean(value)),
        action: "commercial.companion_action_appeal_assigned",
        resourceType: "companionAccountAppeal",
        resourceId: appealId,
        metadata: {
          companionId: existing.companionId,
          actionId: existing.actionId,
          previousAssignedToUserId,
          assignedToUserId: input.assignedToUserId,
          originalActionCreatedById: existing.action.createdById
        }
      }, db);
      return this.companionAppealStaffDto({
        ...existing,
        ...updated,
        assignedTo: null
      }, actorId);
    });
  }

  async adminAppeals(
    actorId: string,
    status = "pending",
    page = 1,
    pageSize = 50,
    reactivationStatus?: "notRequired" | "required" | "completed"
  ) {
    const actor = await this.assertCompanionAppealStaff(
      this.prisma as any,
      actorId,
      ["supply", "admin"]
    );
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = {
      status,
      ...(reactivationStatus ? { reactivationStatus } : {}),
      ...(actor.role === "supply" ? { assignedToUserId: actorId } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.companionAccountAppeal.findMany({
        where,
        include: {
          ...this.companionAppealAdminInclude()
        },
        orderBy: [{ reviewDueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionAccountAppeal.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.companionAppealStaffDto(item, actorId)),
      pagination: {
        total,
        totalPages: Math.ceil(total / safePageSize),
        page: safePage,
        pageSize: safePageSize
      },
      scope: actor.role === "admin" ? "all" : "assignedToMe"
    };
  }

  async adminVoiceIntros(status = "pendingReview", page = 1, pageSize = 50) {
    this.assertVoiceIntroEnabled();
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = { voiceIntroStatus: status };
    const [items, total] = await Promise.all([
      this.prisma.companionProfile.findMany({
      where,
      select: {
        id: true,
        name: true,
        ownerUserId: true,
        voiceIntroAssetRef: true,
        voiceIntroDurationSeconds: true,
        voiceIntroStatus: true,
        updatedAt: true
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize
    } as any),
      this.prisma.companionProfile.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => ({
        companionId: item.id,
        companionName: item.name,
        ownerUserId: item.ownerUserId,
        assetReference: item.voiceIntroAssetRef,
        durationSeconds: item.voiceIntroDurationSeconds,
        status: item.voiceIntroStatus,
        submittedAt: item.updatedAt.toISOString()
      })),
      pagination: this.pagination(safePage, safePageSize, total)
    };
  }

  async adminTraining(status?: string, page = 1, pageSize = 50) {
    const now = new Date();
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = status === "expired"
      ? {
          OR: [
            { status: "expired" },
            { status: "passed", expiresAt: { lte: now } }
          ]
        }
      : status === "passed"
        ? { status: "passed", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
        : status
          ? { status }
          : {};
    const [items, total] = await Promise.all([
      this.prisma.companionTrainingRecord.findMany({
      where,
      include: { companion: { select: { id: true, name: true, ownerUserId: true } } },
      orderBy: [{ expiresAt: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize
    } as any),
      this.prisma.companionTrainingRecord.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => ({
        ...this.trainingRecordDto(item),
        status: item.status === "passed" && item.expiresAt?.getTime() <= now.getTime() ? "expired" : item.status,
        companion: item.companion
      })),
      pagination: this.pagination(safePage, safePageSize, total)
    };
  }

  async adminReviewDue(page = 1, pageSize = 50) {
    const now = new Date();
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = {
        status: "verified",
        OR: [{ nextReviewDueAt: null }, { nextReviewDueAt: { lte: now } }]
      };
    const [items, total] = await Promise.all([
      this.prisma.companionCommercialProfile.findMany({
      where,
      include: { companion: { select: { id: true, name: true, ownerUserId: true, isPublished: true } } },
      orderBy: [{ nextReviewDueAt: "asc" }, { verifiedAt: "asc" }, { companionId: "asc" }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize
    } as any),
      this.prisma.companionCommercialProfile.count({ where } as any)
    ]);
    return {
      checkedAt: now.toISOString(),
      items: items.map((item: any) => ({
        companion: item.companion,
        commercialStatus: item.status,
        verifiedAt: item.verifiedAt?.toISOString() ?? null,
        nextReviewDueAt: item.nextReviewDueAt?.toISOString() ?? null,
        reason: item.nextReviewDueAt ? "scheduledReviewDue" : "reviewDateMissing"
      })),
      pagination: this.pagination(safePage, safePageSize, total)
    };
  }

  async adminAccountActions(
    actorId: string,
    active?: boolean,
    page = 1,
    pageSize = 50,
    reactivationStatus?: "notRequired" | "required" | "completed"
  ) {
    const now = new Date();
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const activityWhere = active === undefined ? {} : active ? {
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }]
    } : {
      OR: [
        { revokedAt: { not: null } },
        { endsAt: { lte: now } }
      ]
    };
    const where = {
      ...activityWhere,
      ...(reactivationStatus ? { reactivationStatus } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.companionAccountAction.findMany({
      where,
      include: {
        companion: { select: { id: true, name: true, ownerUserId: true } },
        appeals: { orderBy: { createdAt: "desc" } }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize
    } as any),
      this.prisma.companionAccountAction.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => ({
        ...this.actionDto(item),
        createdById: item.createdById,
        companion: item.companion,
        appeals: item.appeals.map((appeal: any) => this.appealDto(appeal)),
        reactivationReviewEligible:
          item.reactivationStatus === "required"
          && Boolean(item.createdById)
          && item.createdById !== actorId
      })),
      pagination: this.pagination(safePage, safePageSize, total)
    };
  }

  async adminIncidents(actorId: string, status?: string, page = 1, pageSize = 50) {
    const actor = await this.assertIncidentStaff(this.prisma as any, actorId, ["supply", "admin"]);
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = {
      ...(status ? { status } : {}),
      ...(actor.role === "supply" ? { assignedToUserId: actorId } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.companionIncidentReport.findMany({
        where,
        include: this.incidentAdminInclude(),
        orderBy: [{ status: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionIncidentReport.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.incidentDto(item, true)),
      pagination: this.pagination(safePage, safePageSize, total),
      scope: actor.role === "admin" ? "all" : "assignedToMe"
    };
  }

  async claimableIncidents(actorId: string, status?: string, page = 1, pageSize = 50) {
    await this.assertIncidentStaff(this.prisma as any, actorId, ["supply"]);
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    if (status && !ACTIVE_COMPANION_INCIDENT_STATUSES.includes(status as any)) {
      return {
        items: [],
        pagination: this.pagination(safePage, safePageSize, 0),
        scope: "claimableSummary" as const
      };
    }
    const statuses = status
      ? status
      : { in: [...ACTIVE_COMPANION_INCIDENT_STATUSES] };
    const where = { assignedToUserId: null, status: statuses };
    const [items, total] = await Promise.all([
      this.prisma.companionIncidentReport.findMany({
        where,
        select: { id: true, status: true, createdAt: true, orderId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionIncidentReport.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => ({
        id: item.id,
        status: item.status,
        submittedAt: item.createdAt.toISOString(),
        hasOrder: Boolean(item.orderId)
      })),
      pagination: this.pagination(safePage, safePageSize, total),
      scope: "claimableSummary"
    };
  }

  async adminIncident(actorId: string, incidentId: string) {
    const actor = await this.assertIncidentStaff(this.prisma as any, actorId, ["supply", "admin"]);
    const incident = await this.prisma.companionIncidentReport.findFirst({
      where: {
        id: incidentId,
        ...(actor.role === "supply" ? { assignedToUserId: actorId } : {})
      },
      include: this.incidentAdminInclude()
    } as any);
    if (!incident) this.throwIncidentNotFound();
    return this.incidentDto(incident, true);
  }

  async claimIncident(actorId: string, incidentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "StaffCredential" WHERE "userId" = ${actorId} FOR UPDATE`;
      await this.assertIncidentStaff(db, actorId, ["supply"]);
      await db.$queryRaw`SELECT "id" FROM "CompanionIncidentReport" WHERE "id" = ${incidentId} FOR UPDATE`;
      const incident = await db.companionIncidentReport.findUnique({
        where: { id: incidentId },
        include: { companion: { select: { ownerUserId: true } } }
      });
      if (!incident) this.throwIncidentNotFound();
      if (!ACTIVE_COMPANION_INCIDENT_STATUSES.includes(incident.status)) {
        throw new AppException(
          "COMPANION_INCIDENT_NOT_CLAIMABLE",
          "Only an unresolved incident can be claimed",
          HttpStatus.CONFLICT
        );
      }
      if (incident.assignedToUserId === actorId) {
        return db.companionIncidentReport.findUniqueOrThrow({
          where: { id: incidentId },
          include: this.incidentAdminInclude()
        });
      }
      if (incident.assignedToUserId) {
        throw new AppException(
          "COMPANION_INCIDENT_ALREADY_ASSIGNED",
          "The incident has already been claimed by another operator",
          HttpStatus.CONFLICT
        );
      }
      const claimedAt = new Date();
      await db.companionIncidentReport.update({
        where: { id: incidentId },
        data: { assignedToUserId: actorId, assignedAt: claimedAt, status: "inReview" }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: incident.companion?.ownerUserId ? [incident.companion.ownerUserId] : [],
        action: "commercial.companion_incident_claimed",
        resourceType: "companionIncidentReport",
        resourceId: incidentId,
        metadata: { companionId: incident.companionId, assignedToUserId: actorId }
      }, db);
      return db.companionIncidentReport.findUniqueOrThrow({
        where: { id: incidentId },
        include: this.incidentAdminInclude()
      });
    }).then((incident) => this.incidentDto(incident, true));
  }

  async assignIncident(
    actorId: string,
    incidentId: string,
    input: AssignCompanionIncidentDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await lockStaffCredentialRowsInOrder(db, [actorId, input.assignedToUserId]);
      await this.assertIncidentStaff(db, actorId, ["admin"]);
      await this.assertIncidentStaff(db, input.assignedToUserId, ["supply"]);
      await db.$queryRaw`SELECT "id" FROM "CompanionIncidentReport" WHERE "id" = ${incidentId} FOR UPDATE`;
      const incident = await db.companionIncidentReport.findUnique({
        where: { id: incidentId },
        include: { companion: { select: { ownerUserId: true } } }
      });
      if (!incident) this.throwIncidentNotFound();
      if (!ACTIVE_COMPANION_INCIDENT_STATUSES.includes(incident.status)) {
        throw new AppException(
          "COMPANION_INCIDENT_NOT_ASSIGNABLE",
          "Only an unresolved incident can be assigned",
          HttpStatus.CONFLICT
        );
      }
      if (incident.assignedToUserId === input.assignedToUserId) {
        return db.companionIncidentReport.findUniqueOrThrow({
          where: { id: incidentId },
          include: this.incidentAdminInclude()
        });
      }
      const previousAssignedToUserId = incident.assignedToUserId ?? null;
      await db.companionIncidentReport.update({
        where: { id: incidentId },
        data: {
          assignedToUserId: input.assignedToUserId,
          assignedAt: new Date(),
          status: "inReview"
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [
          incident.companion?.ownerUserId,
          previousAssignedToUserId,
          input.assignedToUserId
        ].filter((value): value is string => Boolean(value)),
        action: "commercial.companion_incident_assigned",
        resourceType: "companionIncidentReport",
        resourceId: incidentId,
        metadata: {
          companionId: incident.companionId,
          previousAssignedToUserId,
          assignedToUserId: input.assignedToUserId
        }
      }, db);
      return db.companionIncidentReport.findUniqueOrThrow({
        where: { id: incidentId },
        include: this.incidentAdminInclude()
      });
    }).then((incident) => this.incidentDto(incident, true));
  }

  async resolveIncident(actorId: string, incidentId: string, input: ResolveCompanionIncidentDto) {
    if (["resolved", "closed"].includes(input.status) && !input.resolution?.trim()) {
      throw new AppException(
        "COMPANION_INCIDENT_RESOLUTION_REQUIRED",
        "Resolved incidents require a resolution",
        HttpStatus.BAD_REQUEST
      );
    }
    const incident = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "StaffCredential" WHERE "userId" = ${actorId} FOR UPDATE`;
      const actor = await this.assertIncidentStaff(db, actorId, ["supply", "admin"]);
      await db.$queryRaw`SELECT "id" FROM "CompanionIncidentReport" WHERE "id" = ${incidentId} FOR UPDATE`;
      const existing = await db.companionIncidentReport.findUnique({ where: { id: incidentId } });
      if (!existing) {
        throw new AppException("COMPANION_INCIDENT_NOT_FOUND", "Incident not found", HttpStatus.NOT_FOUND);
      }
      if (["resolved", "closed"].includes(existing.status)) {
        throw new AppException("COMPANION_INCIDENT_ALREADY_RESOLVED", "Incident is already resolved", HttpStatus.CONFLICT);
      }
      if (actor.role === "supply" && existing.assignedToUserId !== actorId) {
        throw new AppException(
          "COMPANION_INCIDENT_ASSIGNEE_REQUIRED",
          "Only the current incident assignee may update this incident",
          HttpStatus.FORBIDDEN
        );
      }
      const terminal = ["resolved", "closed"].includes(input.status);
      const updated = await db.companionIncidentReport.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          resolution: input.resolution?.trim() ?? null,
          resolvedAt: terminal ? new Date() : null,
          resolvedById: terminal ? actorId : null
        }
      });
      const companion = await db.companionProfile.findUnique({
        where: { id: existing.companionId },
        select: { ownerUserId: true }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: companion?.ownerUserId ? [companion.ownerUserId] : [],
        action: "commercial.companion_incident_updated",
        resourceType: "companionIncidentReport",
        resourceId: existing.id,
        metadata: { companionId: existing.companionId, orderId: existing.orderId, status: input.status }
      }, db);
      return db.companionIncidentReport.findUniqueOrThrow({
        where: { id: updated.id },
        include: this.incidentAdminInclude()
      });
    });
    return this.incidentDto(incident, true);
  }

  async adminWithdrawals(status?: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.companionWithdrawalRequest.findMany({
      where,
      include: { companion: { select: { id: true, name: true, ownerUserId: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize
    } as any),
      this.prisma.companionWithdrawalRequest.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.withdrawalDto(item, true)),
      pagination: this.pagination(safePage, safePageSize, total)
    };
  }

  async updateWithdrawal(actorId: string, requestId: string, input: UpdateWithdrawalRequestDto) {
    const allowedTransitions: Record<string, string[]> = {
      requested: ["reviewing", "approved", "rejected"],
      reviewing: ["approved", "rejected"],
      approved: ["processing"],
      processing: ["paid"]
    };
    const request = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionWithdrawalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
      const existing = await db.companionWithdrawalRequest.findUnique({
        where: { id: requestId },
        include: { companion: { select: { ownerUserId: true } } }
      });
      if (!existing) {
        throw new AppException("WITHDRAWAL_REQUEST_NOT_FOUND", "Withdrawal request not found", HttpStatus.NOT_FOUND);
      }
      if (!allowedTransitions[existing.status]?.includes(input.status)) {
        throw new AppException(
          "WITHDRAWAL_REQUEST_INVALID_STATE",
          "Withdrawal request cannot move to the requested status",
          HttpStatus.CONFLICT
        );
      }
      if (input.status === "rejected" && !input.rejectionReason?.trim()) {
        throw new AppException("WITHDRAWAL_REJECTION_REASON_REQUIRED", "A rejection reason is required", HttpStatus.BAD_REQUEST);
      }
      if (input.status === "paid") {
        if (!input.payoutReferenceMasked?.trim()) {
          throw new AppException(
            "WITHDRAWAL_PAYOUT_REFERENCE_REQUIRED",
            "A masked payout reference is required",
            HttpStatus.BAD_REQUEST
          );
        }
        const paidCount = await db.companionEarning.count({
          where: { id: { in: existing.earningIds }, companionId: existing.companionId, status: "paid" }
        });
        if (paidCount !== existing.earningIds.length) {
          throw new AppException(
            "WITHDRAWAL_EARNINGS_NOT_PAID",
            "Every earning must be independently verified as paid before closing the withdrawal",
            HttpStatus.CONFLICT
          );
        }
      }
      const now = new Date();
      const updated = await db.companionWithdrawalRequest.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          reviewedAt: ["reviewing", "approved", "rejected"].includes(input.status)
            ? existing.reviewedAt ?? now
            : existing.reviewedAt,
          reviewedById: ["reviewing", "approved", "rejected"].includes(input.status)
            ? actorId
            : existing.reviewedById,
          processedAt: input.status === "paid" ? now : existing.processedAt,
          payoutReferenceMasked: input.payoutReferenceMasked?.trim() ?? existing.payoutReferenceMasked,
          rejectionReason: input.rejectionReason?.trim() ?? null
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: existing.companion?.ownerUserId
          ? [existing.companion.ownerUserId]
          : [],
        action: "commercial.companion_withdrawal_updated",
        resourceType: "companionWithdrawalRequest",
        resourceId: existing.id,
        metadata: {
          companionId: existing.companionId,
          previousStatus: existing.status,
          status: input.status,
          amountCents: existing.amountCents
        }
      }, db);
      return updated;
    });
    return this.withdrawalDto(request);
  }

  private async ownCompanion(userId: string) {
    const companion = await this.prisma.companionProfile.findUnique({
      where: { ownerUserId: userId },
      select: {
        id: true,
        name: true,
        role: true,
        bio: true,
        languages: true,
        specialties: true,
        cityDistrict: true,
        livedExperience: true,
        serviceBoundaries: true,
        isPublished: true,
        voiceIntroAssetRef: true,
        voiceIntroDurationSeconds: true,
        voiceIntroStatus: true
      }
    } as any);
    if (!companion) {
      throw new AppException("COMPANION_PROFILE_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
    }
    return companion as any;
  }

  private async commercialProfileForCompanion(companionId: string) {
    const profile = await this.prisma.companionCommercialProfile.findUnique({ where: { companionId } } as any);
    if (!profile) {
      return {
        status: "notSubmitted",
        settlementRecipientMasked: null,
        serviceAgreementVersion: null,
        submittedAt: null,
        verifiedAt: null,
        suspendedAt: null,
        suspendedReason: null,
        nextReviewDueAt: null,
        adultEligibility: {
          verdict: "pending",
          verifiedAt: null,
          validUntil: null,
          evidenceAvailable: false
        },
        evidence: {
          settlementRecipient: false,
          taxProfile: false,
          identity: false,
          serviceAgreement: false
        }
      };
    }
    return {
      status: profile.status,
      settlementRecipientMasked: profile.settlementRecipientMasked,
      serviceAgreementVersion: profile.serviceAgreementVersion,
      submittedAt: profile.submittedAt.toISOString(),
      verifiedAt: profile.verifiedAt?.toISOString() ?? null,
      suspendedAt: profile.suspendedAt?.toISOString() ?? null,
      suspendedReason: profile.suspendedReason ?? null,
      nextReviewDueAt: profile.nextReviewDueAt?.toISOString() ?? null,
      adultEligibility: {
        verdict: profile.adultEligibilityVerdict,
        verifiedAt: profile.adultEligibilityVerifiedAt?.toISOString() ?? null,
        validUntil: profile.adultEligibilityValidUntil?.toISOString() ?? null,
        evidenceAvailable: Boolean(profile.adultEligibilityEvidenceRef)
      },
      evidence: {
        settlementRecipient: Boolean(profile.settlementRecipientRef),
        taxProfile: Boolean(profile.taxProfileRef),
        identity: Boolean(profile.identityEvidenceRef),
        serviceAgreement: Boolean(profile.serviceAgreementEvidenceRef)
      }
    };
  }

  private async trainingForCompanion(companionId: string) {
    const records = await this.prisma.companionTrainingRecord.findMany({
      where: { companionId },
      orderBy: { updatedAt: "desc" }
    } as any);
    const now = Date.now();
    const byKey = new Map(records.map((record: any) => [`${record.moduleCode}:${record.moduleVersion}`, record]));
    const modules = TRAINING_MODULES.map((module) => {
      const record: any = byKey.get(`${module.code}:${module.version}`);
      const expired = record?.status === "passed"
        && record.expiresAt
        && record.expiresAt.getTime() <= now;
      return {
        code: module.code,
        version: module.version,
        title: module.title,
        kind: module.kind,
        summary: module.summary,
        passScore: module.passScore,
        validityDays: module.validityDays,
        questions: module.questions.map(({ answer: _answer, ...question }) => question),
        record: record ? {
          ...this.trainingRecordDto(record),
          status: expired ? "expired" : record.status
        } : null
      };
    });
    const complete = modules.every((module) => module.record?.status === "passed");
    return {
      complete,
      requiredModuleCodes: REQUIRED_TRAINING_CODES,
      modules
    };
  }

  private trainingRecordDto(record: any) {
    return {
      id: record.id,
      moduleCode: record.moduleCode,
      moduleVersion: record.moduleVersion,
      status: record.status,
      attemptCount: record.attemptCount,
      bestScore: record.bestScore,
      lastAttemptedAt: record.lastAttemptedAt?.toISOString() ?? null,
      passedAt: record.passedAt?.toISOString() ?? null,
      expiresAt: record.expiresAt?.toISOString() ?? null
    };
  }

  private async qualityForCompanion(companionId: string) {
    const [orders, orderPopulationSize, ratingProjection, openSupportTickets, activeActions] = await Promise.all([
      this.prisma.order.findMany({
        where: { companionId },
        select: {
          status: true,
          createdAt: true,
          scheduledAt: true,
          companionConfirmedAt: true,
          companionResponseDeadlineAt: true,
          serviceStartedAt: true,
          completedAt: true,
          refunds: { select: { status: true } }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 500
      } as any),
      this.prisma.order.count({ where: { companionId } } as any),
      this.prisma.companionProfile.findUnique({
        where: { id: companionId },
        select: { rating: true, reviewCount: true }
      } as any),
      this.prisma.supportTicket.count({
        where: {
          order: { companionId },
          status: { in: ["open", "inProgress"] }
        }
      } as any),
      this.prisma.companionAccountAction.count({
        where: {
          companionId,
          revokedAt: null,
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }]
        }
      } as any)
    ]);
    const responseEligible = orders.filter((order: any) => order.companionResponseDeadlineAt);
    const acceptedInTime = responseEligible.filter((order: any) =>
      order.companionConfirmedAt
      && order.companionConfirmedAt.getTime() <= order.companionResponseDeadlineAt.getTime()
    );
    const startEligible = orders.filter((order: any) =>
      order.serviceStartedAt && ["inService", "completed", "refunded"].includes(order.status)
    );
    const startedOnTime = startEligible.filter((order: any) =>
      order.serviceStartedAt.getTime() <= order.scheduledAt.getTime() + 10 * 60_000
    );
    const completionEligible = orders.filter((order: any) =>
      ["paid", "inService", "completed", "refunded"].includes(order.status)
    );
    const completed = completionEligible.filter((order: any) => Boolean(order.completedAt));
    const refunded = orders.filter((order: any) =>
      order.status === "refunded"
      || order.refunds.some((refund: any) => refund.status === "success")
    );
    return {
      generatedAt: new Date().toISOString(),
      orderSampleSize: orders.length,
      orderSampleLimit: 500,
      orderPopulationSize,
      orderSampleTruncated: orderPopulationSize > orders.length,
      acceptedWithinDeadline: this.rateMetric(acceptedInTime.length, responseEligible.length),
      startedWithinTenMinutes: this.rateMetric(startedOnTime.length, startEligible.length),
      completion: this.rateMetric(completed.length, completionEligible.length),
      refund: this.rateMetric(refunded.length, orders.length),
      rating: {
        value: ratingProjection && ratingProjection.reviewCount > 0
          ? ratingProjection.rating
          : null,
        sampleSize: ratingProjection?.reviewCount ?? 0
      },
      openSupportTickets,
      activeAccountActions: activeActions,
      limitations: [
        ...(orderPopulationSize > orders.length
          ? [`订单指标采用最近 ${orders.length}/${orderPopulationSize} 笔服务记录；更早记录未混入当前滚动样本。`]
          : [`订单指标覆盖当前全部 ${orderPopulationSize} 笔服务记录。`]),
        "按时开始只统计已有真实 serviceStartedAt 的订单；没有采集证据的订单不会被当作准时。",
        "待确认订单被拒绝和超时目前没有独立响应事件，因此此处展示的是按时接受率，不伪装为完整响应率。"
      ]
    };
  }

  private rateMetric(numerator: number, denominator: number) {
    return {
      value: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null,
      numerator,
      denominator
    };
  }

  private async operationalSummaryForCompanion(companionId: string) {
    const now = new Date();
    const [activeRestrictionCount, openIncidentCount] = await Promise.all([
      this.prisma.companionAccountAction.count({
        where: {
          companionId,
          kind: { in: ["serviceRestriction", "suspension"] },
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }]
        }
      } as any),
      this.prisma.companionIncidentReport.count({
        where: { companionId, status: { in: ["open", "inReview"] } }
      } as any)
    ]);
    return { activeRestrictionCount, openIncidentCount };
  }

  private async actionsForCompanion(
    companionId: string,
    active?: boolean,
    page = 1,
    pageSize = 100,
    actionId?: string
  ) {
    const now = new Date();
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where: any = {
      companionId,
      ...(actionId ? { id: actionId } : {}),
      ...(active === undefined ? {} : active ? {
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }]
      } : {
        OR: [{ revokedAt: { not: null } }, { endsAt: { lte: now } }]
      })
    };
    const [items, total] = await Promise.all([
      this.prisma.companionAccountAction.findMany({
      where,
      include: {
        appeals: {
          include: this.caseEvidence.attachmentInclude(),
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize
    } as any),
      this.prisma.companionAccountAction.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => ({
        ...this.actionDto(item),
        appeals: item.appeals.map((appeal: any) => this.appealDto(appeal))
      })),
      pagination: this.pagination(safePage, safePageSize, total)
    };
  }

  private actionDto(action: any) {
    const now = Date.now();
    const reactivationStatus = action.reactivationStatus ?? "notRequired";
    const expired = action.endsAt instanceof Date && action.endsAt.getTime() <= now;
    const nextAction = reactivationStatus === "required"
      ? "awaitIndependentOperationalReview"
      : reactivationStatus === "completed"
        ? "awaitExplicitPublicationDecision"
        : !action.revokedAt && expired && action.kind === "suspension"
          ? "awaitExpiryReactivationMaterialization"
          : !action.revokedAt && expired && action.kind === "serviceRestriction"
            ? "awaitExplicitPublicationDecision"
            : "none";
    return {
      id: action.id,
      companionId: action.companionId,
      kind: action.kind,
      reasonCode: action.reasonCode,
      message: action.message,
      startsAt: action.startsAt.toISOString(),
      endsAt: action.endsAt?.toISOString() ?? null,
      appealDeadlineAt: action.appealDeadlineAt.toISOString(),
      appealWindowOpen:
        !action.revokedAt
        && (!action.endsAt || action.endsAt.getTime() > now)
        && action.appealDeadlineAt.getTime() > now,
      revokedAt: action.revokedAt?.toISOString() ?? null,
      active: !action.revokedAt
        && action.startsAt.getTime() <= now
        && (!action.endsAt || action.endsAt.getTime() > now),
      reactivation: {
        status: reactivationStatus,
        required: reactivationStatus === "required",
        requiredAt: action.reactivationRequiredAt?.toISOString?.() ?? null,
        completedAt: action.reactivationCompletedAt?.toISOString?.() ?? null,
        resolution: action.reactivationResolution ?? null,
        publicationRestored: false,
        nextAction
      },
      createdAt: action.createdAt.toISOString()
    };
  }

  private assertExpiredSuspensionReactivationState(
    action: any,
    actorId: string,
    now: Date
  ) {
    if (
      action.kind !== "suspension"
      || action.revokedAt
      || !(action.endsAt instanceof Date)
      || action.endsAt.getTime() > now.getTime()
      || action.reactivationStatus !== "required"
    ) {
      throw new AppException(
        "COMPANION_REACTIVATION_NOT_REQUIRED",
        "This temporary suspension is not awaiting an expiry reactivation review",
        HttpStatus.CONFLICT
      );
    }
    if (!action.createdById || action.createdById === actorId) {
      throw new AppException(
        "COMPANION_REACTIVATION_INDEPENDENT_REVIEW_REQUIRED",
        "The original suspension creator cannot complete its reactivation review",
        HttpStatus.CONFLICT
      );
    }
  }

  private assertReactivationReviewState(appeal: any, actorId: string) {
    if (
      appeal.status !== "overturned"
      || appeal.reactivationStatus !== "required"
      || !["serviceRestriction", "suspension"].includes(appeal.action?.kind)
      || !appeal.action?.revokedAt
    ) {
      throw new AppException(
        "COMPANION_REACTIVATION_NOT_REQUIRED",
        "This appeal is not awaiting a reactivation review",
        HttpStatus.CONFLICT
      );
    }
    if (
      !appeal.action.createdById
      || !appeal.resolvedById
      || appeal.action.createdById === actorId
      || appeal.resolvedById === actorId
    ) {
      throw new AppException(
        "COMPANION_REACTIVATION_INDEPENDENT_REVIEW_REQUIRED",
        "Reactivation must be completed by someone other than the original action creator and appeal reviewer",
        HttpStatus.CONFLICT
      );
    }
  }

  private appealDto(appeal: any) {
    const reactivationStatus = appeal.reactivationStatus ?? "notRequired";
    return {
      id: appeal.id,
      actionId: appeal.actionId,
      statement: appeal.statement,
      evidenceAttachments: this.caseEvidence.attachmentDtos(appeal),
      legacyEvidenceReferenceCount: appeal.legacyEvidenceReferenceCount ?? 0,
      status: appeal.status,
      reviewDueAt: appeal.reviewDueAt.toISOString(),
      overdue:
        appeal.status === "pending" && appeal.reviewDueAt.getTime() <= Date.now(),
      resolution: appeal.resolution ?? null,
      resolvedAt: appeal.resolvedAt?.toISOString() ?? null,
      reactivation: {
        status: reactivationStatus,
        required: reactivationStatus === "required",
        requiredAt: appeal.reactivationRequiredAt?.toISOString?.() ?? null,
        completedAt: appeal.reactivationCompletedAt?.toISOString?.() ?? null,
        resolution: appeal.reactivationResolution ?? null,
        publicationRestored: false,
        nextAction: reactivationStatus === "required"
          ? "awaitIndependentOperationalReview"
          : reactivationStatus === "completed"
            ? "awaitExplicitPublicationDecision"
            : "none"
      },
      createdAt: appeal.createdAt.toISOString()
    };
  }

  private companionAppealAdminInclude() {
    return {
      action: true,
      companion: { select: { id: true, name: true, ownerUserId: true } },
      assignedTo: {
        select: { id: true, role: true, profile: { select: { displayName: true } } }
      },
      ...this.caseEvidence.attachmentInclude()
    } as const;
  }

  private companionAppealStaffDto(appeal: any, actorId: string) {
    const dto = this.appealDto(appeal);
    const independentReviewEligible =
      Boolean(appeal.action?.createdById) && appeal.action.createdById !== actorId;
    const assignedToActor = appeal.assignedToUserId === actorId;
    return {
      ...dto,
      // Queue routing can expose the appeal record to an administrator, but
      // raw evidence metadata and signed URLs belong only to the current
      // independent assignee.
      evidenceAttachments:
        independentReviewEligible && assignedToActor ? dto.evidenceAttachments : [],
      companion: appeal.companion,
      action: this.actionDto(appeal.action),
      assignedToUserId: appeal.assignedToUserId ?? null,
      assignedAt: appeal.assignedAt?.toISOString?.() ?? null,
      assignedTo: appeal.assignedTo
        ? {
            userId: appeal.assignedTo.id,
            role: appeal.assignedTo.role,
            displayName: appeal.assignedTo.profile?.displayName ?? null
          }
        : null,
      independentReviewEligible,
      assignedToActor,
      reactivationReviewEligible:
        appeal.status === "overturned"
        && appeal.reactivationStatus === "required"
        && independentReviewEligible
        && Boolean(appeal.resolvedById)
        && appeal.resolvedById !== actorId
    };
  }

  private assertCompanionAppealReviewable(existing: any, actorId: string): asserts existing {
    if (!existing) {
      throw new AppException(
        "COMPANION_APPEAL_NOT_FOUND",
        "Appeal not found",
        HttpStatus.NOT_FOUND
      );
    }
    if (existing.status !== "pending") {
      throw new AppException(
        "COMPANION_APPEAL_ALREADY_RESOLVED",
        "Appeal is already resolved",
        HttpStatus.CONFLICT
      );
    }
    if (!existing.action?.createdById || existing.action.createdById === actorId) {
      throw new AppException(
        "COMPANION_APPEAL_INDEPENDENT_REVIEW_REQUIRED",
        "The original account-action creator cannot process its appeal",
        HttpStatus.CONFLICT
      );
    }
  }

  private async assertCompanionAppealStaff(
    db: any,
    actorId: string,
    allowedRoles: readonly ("supply" | "admin")[]
  ): Promise<{ id: string; role: "supply" | "admin" }> {
    const credential = await (db.staffCredential ?? this.prisma.staffCredential).findUnique({
      where: { userId: actorId },
      include: { user: { select: { id: true, role: true, accountStatus: true } } }
    });
    if (
      !credential
      || credential.status !== "active"
      || credential.user.accountStatus !== "active"
      || !allowedRoles.includes(credential.user.role)
    ) {
      throw new AppException(
        "COMPANION_APPEAL_STAFF_REQUIRED",
        "An active authorized companion-appeal operator is required",
        HttpStatus.FORBIDDEN
      );
    }
    return { id: credential.user.id, role: credential.user.role };
  }

  private incidentAdminInclude() {
    return {
      companion: { select: { id: true, name: true, ownerUserId: true } },
      order: { select: { id: true, status: true, scheduledAt: true } },
      assignedTo: {
        select: { id: true, role: true, profile: { select: { displayName: true } } }
      },
      ...this.caseEvidence.attachmentInclude()
    } as const;
  }

  private async assertIncidentStaff(
    db: any,
    actorId: string,
    allowedRoles: readonly ("supply" | "admin")[]
  ): Promise<{ id: string; role: "supply" | "admin" }> {
    const credential = await db.staffCredential.findUnique({
      where: { userId: actorId },
      include: { user: { select: { id: true, role: true, accountStatus: true } } }
    });
    if (
      !credential
      || credential.status !== "active"
      || credential.user.accountStatus !== "active"
      || !allowedRoles.includes(credential.user.role)
    ) {
      throw new AppException(
        "COMPANION_INCIDENT_STAFF_REQUIRED",
        "An active authorized incident operator is required",
        HttpStatus.FORBIDDEN
      );
    }
    return { id: credential.user.id, role: credential.user.role };
  }

  private throwIncidentNotFound(): never {
    throw new AppException(
      "COMPANION_INCIDENT_NOT_FOUND",
      "Incident not found",
      HttpStatus.NOT_FOUND
    );
  }

  private async incidentsForCompanion(companionId: string, status?: string, page = 1, pageSize = 100) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = { companionId, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.companionIncidentReport.findMany({
        where,
        include: this.caseEvidence.attachmentInclude(),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionIncidentReport.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.incidentDto(item)),
      pagination: this.pagination(safePage, safePageSize, total)
    };
  }

  private incidentDto(incident: any, includeOperations = false) {
    const dto = {
      id: incident.id,
      companionId: incident.companionId,
      orderId: incident.orderId ?? null,
      category: incident.category,
      summary: incident.summary,
      evidenceAttachments: this.caseEvidence.attachmentDtos(incident),
      status: incident.status,
      resolution: incident.resolution ?? null,
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      createdAt: incident.createdAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString()
    } as Record<string, unknown>;
    if (includeOperations) {
      dto.companion = incident.companion ?? null;
      dto.assignedTo = incident.assignedTo
        ? {
            userId: incident.assignedTo.id,
            displayName: incident.assignedTo.profile?.displayName ?? null,
            role: incident.assignedTo.role
          }
        : null;
      dto.assignedAt = incident.assignedAt?.toISOString?.() ?? null;
      dto.order = incident.order ? {
        id: incident.order.id,
        status: incident.order.status,
        scheduledAt: incident.order.scheduledAt.toISOString()
      } : null;
    }
    return dto;
  }

  private async withdrawalsForCompanion(companionId: string, status?: string, page = 1, pageSize = 100) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = { companionId, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.companionWithdrawalRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionWithdrawalRequest.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.withdrawalDto(item)),
      pagination: this.pagination(safePage, safePageSize, total)
    };
  }

  private pagination(page: number, pageSize: number, total: number) {
    return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  private withdrawalDto(request: any, includeOperations = false) {
    const dto = {
      id: request.id,
      earningIds: request.earningIds,
      amountCents: request.amountCents,
      settlementRecipientMasked: request.settlementRecipientMasked,
      status: request.status,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      processedAt: request.processedAt?.toISOString() ?? null,
      payoutReferenceMasked: request.payoutReferenceMasked ?? null,
      rejectionReason: request.rejectionReason ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString()
    } as Record<string, unknown>;
    if (includeOperations) {
      dto.companionId = request.companionId;
      dto.companion = request.companion ?? null;
    }
    return dto;
  }

}
