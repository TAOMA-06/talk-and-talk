import { createHash, createHmac } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ControlledCaseEvidenceService } from "../moderation/media/controlled-case-evidence.service";
import {
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
          assetReference: companion.voiceIntroAssetRef ?? null,
          durationSeconds: companion.voiceIntroDurationSeconds ?? null,
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
    const companion = await this.ownCompanion(userId);
    const action = await this.prisma.companionAccountAction.findFirst({
      where: { id: actionId, companionId: companion.id }
    } as any);
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
    if (action.appealDeadlineAt.getTime() <= now.getTime()) {
      throw new AppException(
        "COMPANION_ACTION_APPEAL_WINDOW_CLOSED",
        "The appeal submission window has closed",
        HttpStatus.CONFLICT,
        { appealDeadlineAt: action.appealDeadlineAt.toISOString() }
      );
    }
    const responseHours = this.config.get<number>("COMPANION_APPEAL_RESPONSE_HOURS") ?? 72;
    const evidenceReferences = this.normalizeReferences(input.evidenceReferences);
    try {
      const appeal = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        const created = await db.companionAccountAppeal.create({
          data: {
            actionId: action.id,
            companionId: companion.id,
            statement: input.statement.trim(),
            evidenceReferences,
            reviewDueAt: new Date(now.getTime() + responseHours * 60 * 60_000)
          }
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
            evidenceCount: evidenceReferences.length,
            appealDeadlineAt: action.appealDeadlineAt.toISOString(),
            reviewDueAt: created.reviewDueAt.toISOString()
          }
        }, db);
        return created;
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
            suspendedReason: input.message.trim()
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

  async resolveAppeal(actorId: string, appealId: string, input: ResolveCompanionAppealDto) {
    const appeal = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionAccountAppeal" WHERE "id" = ${appealId} FOR UPDATE`;
      const existing = await db.companionAccountAppeal.findUnique({
        where: { id: appealId },
        include: {
          action: true,
          companion: { select: { ownerUserId: true } }
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
      const now = new Date();
      const updated = await db.companionAccountAppeal.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          resolution: input.resolution.trim(),
          resolvedAt: now,
          resolvedById: actorId
        }
      });
      if (input.status === "overturned") {
        await db.companionAccountAction.update({
          where: { id: existing.actionId },
          data: { revokedAt: now, revokedById: actorId }
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
          independentReview: true
        }
      }, db);
      if (existing.companion?.ownerUserId) {
        await this.notifications.createTransactional(db, {
          userId: existing.companion.ownerUserId,
          type: "supportUpdate",
          title: input.status === "overturned"
            ? "陪伴者申诉已撤销原处置"
            : "陪伴者申诉已有结果",
          body: input.resolution.trim(),
          data: {
            route: "companionDevelopment",
            actionId: existing.actionId,
            appealId: existing.id,
            appealStatus: input.status
          },
          eventKey: `companion-account-appeal:${existing.id}:resolved:${input.status}:${existing.companion.ownerUserId}`,
          templateKey: "supportUpdate"
        });
      }
      return updated;
    });
    return this.appealDto(appeal);
  }

  async createVoiceIntroReadUrl(actorId: string, companionId: string) {
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

  async adminAppeals(
    actorId: string,
    status = "pending",
    page = 1,
    pageSize = 50
  ) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = { status };
    const [items, total] = await Promise.all([
      this.prisma.companionAccountAppeal.findMany({
        where,
        include: {
          action: true,
          companion: { select: { id: true, name: true, ownerUserId: true } }
        },
        orderBy: [{ reviewDueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionAccountAppeal.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => ({
        ...this.appealDto(item),
        companion: item.companion,
        action: this.actionDto(item.action),
        independentReviewEligible:
          Boolean(item.action?.createdById) && item.action.createdById !== actorId
      })),
      pagination: {
        total,
        totalPages: Math.ceil(total / safePageSize),
        page: safePage,
        pageSize: safePageSize
      }
    };
  }

  async adminVoiceIntros(status = "pendingReview", page = 1, pageSize = 50) {
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

  async adminAccountActions(active?: boolean, page = 1, pageSize = 50) {
    const now = new Date();
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = active === undefined ? {} : active ? {
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }]
    } : {
      OR: [
        { revokedAt: { not: null } },
        { endsAt: { lte: now } }
      ]
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
        companion: item.companion,
        appeals: item.appeals.map((appeal: any) => this.appealDto(appeal))
      })),
      pagination: this.pagination(safePage, safePageSize, total)
    };
  }

  async adminIncidents(status?: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.companionIncidentReport.findMany({
      where,
      include: {
        companion: { select: { id: true, name: true, ownerUserId: true } },
        order: { select: { id: true, status: true, scheduledAt: true } },
        ...this.caseEvidence.attachmentInclude()
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize
    } as any),
      this.prisma.companionIncidentReport.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.incidentDto(item, true)),
      pagination: this.pagination(safePage, safePageSize, total)
    };
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
      await db.$queryRaw`SELECT "id" FROM "CompanionIncidentReport" WHERE "id" = ${incidentId} FOR UPDATE`;
      const existing = await db.companionIncidentReport.findUnique({ where: { id: incidentId } });
      if (!existing) {
        throw new AppException("COMPANION_INCIDENT_NOT_FOUND", "Incident not found", HttpStatus.NOT_FOUND);
      }
      if (["resolved", "closed"].includes(existing.status)) {
        throw new AppException("COMPANION_INCIDENT_ALREADY_RESOLVED", "Incident is already resolved", HttpStatus.CONFLICT);
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
        include: this.caseEvidence.attachmentInclude()
      });
    });
    return this.incidentDto(incident);
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
      include: { appeals: { orderBy: { createdAt: "desc" } } },
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
        !action.revokedAt && action.appealDeadlineAt.getTime() > now,
      revokedAt: action.revokedAt?.toISOString() ?? null,
      active: !action.revokedAt
        && action.startsAt.getTime() <= now
        && (!action.endsAt || action.endsAt.getTime() > now),
      createdAt: action.createdAt.toISOString()
    };
  }

  private appealDto(appeal: any) {
    return {
      id: appeal.id,
      actionId: appeal.actionId,
      statement: appeal.statement,
      evidenceReferences: appeal.evidenceReferences,
      status: appeal.status,
      reviewDueAt: appeal.reviewDueAt.toISOString(),
      overdue:
        appeal.status === "pending" && appeal.reviewDueAt.getTime() <= Date.now(),
      resolution: appeal.resolution ?? null,
      resolvedAt: appeal.resolvedAt?.toISOString() ?? null,
      createdAt: appeal.createdAt.toISOString()
    };
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

  private normalizeReferences(references?: string[]) {
    return [...new Set((references ?? []).map((reference) => reference.trim()).filter(Boolean))];
  }
}
