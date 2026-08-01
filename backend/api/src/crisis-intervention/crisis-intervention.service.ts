import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { CreateCrisisInterventionDto } from "./dto/crisis-intervention.dto";

export const CRISIS_RESOURCE_POLICY_VERSION = "cn-emergency-resources-2026-08-01";

type CrisisInterventionRecord = {
  id: string;
  userId: string;
  source: string;
  riskCode: string;
  region: string;
  resourcePolicyVersion: string;
  status: string;
  resourcesViewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CrisisInterventionDatabase = {
  $queryRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  crisisIntervention: {
    findFirst(args: unknown): Promise<CrisisInterventionRecord | null>;
    create(args: unknown): Promise<CrisisInterventionRecord>;
  };
};

/**
 * Deliberately excludes content, message ids, reasons, and model output. Chat
 * callers can pass only the minimum classification needed for resource routing.
 */
export type CriticalModerationSignal = {
  priority: string;
  categories: readonly string[];
};

const EMERGENCY_BASELINE = [
  {
    code: "110",
    name: "公安报警电话",
    kind: "policeEmergency",
    phone: "110",
    region: "CN",
    availability: "紧急情况请立即拨打，以所在地接通情况为准",
    officialSourceOrganization: "北京市通信管理局（工业和信息化部属地管理机构）",
    officialSourceTitle: "我国常用公益服务号码说明",
    officialSourceUrl: "https://bjca.miit.gov.cn/zwgk/tzgg/art/2022/art_8d4eb93ee3424f30826c97ee400e8937.html",
    lastVerifiedOn: "2026-08-01"
  },
  {
    code: "120",
    name: "医疗急救电话",
    kind: "medicalEmergency",
    phone: "120",
    region: "CN",
    availability: "需要紧急医疗救助时请立即拨打，以所在地接通情况为准",
    officialSourceOrganization: "国家卫生健康委员会",
    officialSourceTitle: "院前医疗急救管理办法",
    officialSourceUrl: "https://www.nhc.gov.cn/wjw/c100175/200405/e92b87688a3447298d83aeed79f3cdab.shtml",
    lastVerifiedOn: "2026-08-01"
  }
] as const;

const APPROVED_MENTAL_HEALTH_RESOURCE = {
  code: "12356",
  name: "全国统一心理援助热线",
  kind: "mentalHealthSupport",
  phone: "12356",
  region: "CN",
  availability: "请直接拨打，以所在地接通与服务安排为准",
  officialSourceOrganization: "国家卫生健康委员会",
  officialSourceTitle: "全国31个省份均已开通12356心理援助热线",
  officialSourceUrl: "https://www.nhc.gov.cn/xcs/c100122/202507/4819417642d4432fb9f227e1e10ca616.shtml",
  lastVerifiedOn: "2026-08-01"
} as const;

@Injectable()
export class CrisisInterventionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  readiness() {
    const approval = this.approvalState();
    return {
      status: approval.approved ? "ready" as const : "noGo" as const,
      ready: approval.approved,
      resourcePolicyVersion: CRISIS_RESOURCE_POLICY_VERSION,
      approvalReferencePresent: Boolean(approval.reference),
      noGoReason: approval.approved
        ? null
        : "CRISIS_RESOURCES_APPROVED=true and a non-secret approval reference are required before commercial release"
    };
  }

  resources(region = "CN") {
    const approval = this.approvalState();
    const approved = approval.approved;
    return {
      policyVersion: CRISIS_RESOURCE_POLICY_VERSION,
      requestedRegion: region,
      coverageRegion: "CN",
      coverageStatus: approved ? "approvedNationalBaseline" as const : "emergencyBaselineOnly" as const,
      approved,
      coverageStatement: approved
        ? "已发布经审批的全国基础紧急与心理援助资源；不代表已穷尽所在地全部区域资源。"
        : "当前仅提供110、120全国基础紧急号码，不代表完整地区资源覆盖；完整资源目录尚未获得发布审批。",
      disclaimers: {
        platformCannotDispatch: true,
        platformCannotDispatchText: "Talk&Talk 不会代替你报警、呼叫救护车或实施现场救援。",
        ordinarySupportNotEmergencyText: "普通客服工单不是紧急服务，不能保证即时响应。"
      },
      resources: approved
        ? [...EMERGENCY_BASELINE, APPROVED_MENTAL_HEALTH_RESOURCE]
        : [...EMERGENCY_BASELINE]
    };
  }

  async create(userId: string, dto: CreateCrisisInterventionDto) {
    try {
      return await this.prisma.$transaction(async (transaction) => this.createPending(
        transaction as unknown as CrisisInterventionDatabase,
        userId,
        dto
      ));
    } catch (error) {
      // The partial unique index is the final race barrier. A concurrent gate
      // that won creation is returned instead of producing a second record.
      if (this.prismaErrorCode(error) === "P2002") {
        const concurrent = await this.findPending(this.prisma, userId);
        if (concurrent) return this.toResponse(concurrent);
      }
      throw error;
    }
  }

  /**
   * Persists an automatic chat safety gate in the caller's transaction. The
   * authenticated sender id must be supplied by the message intake path; this
   * method never accepts a reported/recipient user id or any message evidence.
   */
  async recordCriticalChatSignal(
    authenticatedSenderId: string,
    signal: CriticalModerationSignal,
    database: CrisisInterventionDatabase
  ) {
    if (signal.priority !== "critical") return null;
    const riskCode = signal.categories.includes("selfHarm")
      ? "selfHarmSignal" as const
      : signal.categories.includes("violence")
        ? "violenceSignal" as const
        : null;
    if (!riskCode) return null;

    return this.createPending(database, authenticatedSenderId, {
      source: "chatSafetyRule",
      riskCode,
      region: "CN"
    });
  }

  async active(userId: string) {
    const record = await this.findPending(this.prisma, userId);
    return { intervention: record ? this.toResponse(record) : null };
  }

  async getOwned(userId: string, id: string) {
    const record = await this.prisma.crisisIntervention.findFirst({ where: { id, userId } });
    if (!record) {
      throw new AppException(
        "CRISIS_INTERVENTION_NOT_FOUND",
        "Crisis intervention was not found",
        HttpStatus.NOT_FOUND
      );
    }
    return this.toResponse(record);
  }

  async completeResourceView(userId: string, id: string) {
    return this.prisma.$transaction(async (transaction) => {
      const database = transaction as unknown as CrisisInterventionDatabase & {
        crisisIntervention: PrismaService["crisisIntervention"];
      };
      await this.lockUserRouting(database, userId);
      const current = await database.crisisIntervention.findFirst({ where: { id, userId } });
      if (!current) {
        throw new AppException(
          "CRISIS_INTERVENTION_NOT_FOUND",
          "Crisis intervention was not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (current.status === "resourcesViewed") return this.toResponse(current);

      const now = new Date();
      await database.crisisIntervention.updateMany({
        where: { id, userId, status: "resourcesPending" },
        data: { status: "resourcesViewed", resourcesViewedAt: now }
      });
      const completed = await database.crisisIntervention.findFirst({ where: { id, userId } });
      if (!completed) {
        throw new AppException(
          "CRISIS_INTERVENTION_NOT_FOUND",
          "Crisis intervention was not found",
          HttpStatus.NOT_FOUND
        );
      }
      return this.toResponse(completed);
    });
  }

  /**
   * Commercial order intake must call this immediately before accepting a new
   * order, and should call it again inside the order transaction if that path
   * can race a resource-view completion.
   */
  async assertResourcesViewedBeforeOrder(
    userId: string,
    database: CrisisInterventionDatabase = this.prisma
  ): Promise<void> {
    // The final order-acceptance check passes its transaction client here. It
    // shares this user lock with create/complete, closing the check/create race.
    if (database !== this.prisma) await this.lockUserRouting(database, userId);
    const pending = await this.findPending(database, userId);
    if (!pending) return;
    throw new AppException(
      "CRISIS_RESOURCES_MUST_BE_VIEWED",
      "Emergency resources must be viewed before continuing to order",
      HttpStatus.CONFLICT,
      {
        interventionId: pending.id,
        resourceRoute: `/crisis/interventions/${pending.id}`,
        resourcePolicyVersion: pending.resourcePolicyVersion
      }
    );
  }

  private async findPending(database: CrisisInterventionDatabase, userId: string) {
    return database.crisisIntervention.findFirst({
      where: { userId, status: "resourcesPending" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
  }

  private async createPending(
    database: CrisisInterventionDatabase,
    userId: string,
    dto: Pick<CreateCrisisInterventionDto, "source" | "riskCode" | "region">
  ) {
    await this.lockUserRouting(database, userId);
    const current = await this.findPending(database, userId);
    if (current) return this.toResponse(current);
    const record = await database.crisisIntervention.create({
      data: {
        userId,
        source: dto.source,
        riskCode: dto.riskCode,
        region: dto.region,
        resourcePolicyVersion: CRISIS_RESOURCE_POLICY_VERSION
      }
    });
    return this.toResponse(record);
  }

  private async lockUserRouting(database: CrisisInterventionDatabase, userId: string): Promise<void> {
    if (!database.$queryRaw) return;
    await database.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${'talk-and-talk:crisis-routing:' + userId}))::text AS "lock"
    `;
  }

  private approvalState() {
    const enabled = this.config.get<boolean>("CRISIS_RESOURCES_APPROVED", false) === true;
    const reference = this.config.get<string>("CRISIS_RESOURCES_APPROVAL_REFERENCE", "").trim();
    return { approved: enabled && Boolean(reference), reference };
  }

  private prismaErrorCode(error: unknown): string | null {
    if (!error || typeof error !== "object" || !("code" in error)) return null;
    return typeof error.code === "string" ? error.code : null;
  }

  private toResponse(record: CrisisInterventionRecord) {
    return {
      id: record.id,
      source: record.source,
      riskCode: record.riskCode,
      region: record.region,
      resourcePolicyVersion: record.resourcePolicyVersion,
      status: record.status,
      resourcesViewedAt: record.resourcesViewedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }
}
