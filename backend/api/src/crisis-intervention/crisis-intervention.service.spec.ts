import { HttpStatus } from "@nestjs/common";

import { CrisisInterventionService } from "./crisis-intervention.service";

describe("CrisisInterventionService", () => {
  const record = (overrides: Record<string, unknown> = {}) => ({
    id: "crisis-1",
    userId: "user-1",
    source: "homeIntent",
    riskCode: "selfHarmSignal",
    region: "CN",
    resourcePolicyVersion: "cn-emergency-resources-2026-08-01",
    status: "resourcesPending",
    resourcesViewedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides
  });

  const build = (approved = false, reference = "") => {
    const crisisIntervention = {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn()
    };
    const prisma: any = {
      crisisIntervention,
      $queryRaw: jest.fn().mockResolvedValue([])
    };
    prisma.$transaction = jest.fn(async (callback: (database: unknown) => Promise<unknown>) => callback(prisma));
    const config = {
      get: jest.fn((key: string, fallback: unknown) => ({
        CRISIS_RESOURCES_APPROVED: approved,
        CRISIS_RESOURCES_APPROVAL_REFERENCE: reference
      } as Record<string, unknown>)[key] ?? fallback)
    };
    return {
      prisma,
      service: new CrisisInterventionService(prisma as any, config as any)
    };
  };

  it("shows only the 110/120 baseline and makes incomplete coverage explicit before approval", () => {
    const { service } = build(false, "");
    const catalog = service.resources("CN-31");

    expect(catalog.approved).toBe(false);
    expect(catalog.coverageStatus).toBe("emergencyBaselineOnly");
    expect(catalog.coverageStatement).toContain("不代表完整地区资源覆盖");
    expect(catalog.resources.map((item) => item.code)).toEqual(["110", "120"]);
    expect(JSON.stringify(catalog.resources)).not.toContain("12356");
    expect(catalog.disclaimers.platformCannotDispatchText).toContain("不会代替你报警");
    expect(catalog.disclaimers.ordinarySupportNotEmergencyText).toContain("不是紧急服务");
  });

  it("adds the dated official mental-health resource only after both approvals are present", () => {
    const { service } = build(true, "safety:crisis-resources-2026-08-01");

    expect(service.readiness()).toEqual(expect.objectContaining({ ready: true, status: "ready" }));
    const catalog = service.resources();
    expect(catalog.resources.map((item) => item.code)).toEqual(["110", "120", "12356"]);
    expect(catalog.resources.every((item) => item.officialSourceUrl.startsWith("https://"))).toBe(true);
    expect(catalog.resources.every((item) => item.lastVerifiedOn === "2026-08-01")).toBe(true);
  });

  it("creates only the structured routing fact and reuses an existing pending intervention", async () => {
    const { prisma, service } = build();
    prisma.crisisIntervention.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record());
    prisma.crisisIntervention.create.mockResolvedValue(record());

    await service.create("user-1", {
      source: "homeIntent",
      riskCode: "selfHarmSignal",
      region: "CN"
    });
    expect(prisma.crisisIntervention.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        source: "homeIntent",
        riskCode: "selfHarmSignal",
        region: "CN",
        resourcePolicyVersion: "cn-emergency-resources-2026-08-01"
      }
    });
    expect(JSON.stringify(prisma.crisisIntervention.create.mock.calls[0][0])).not.toMatch(/content|message|statement|body/i);

    await service.create("user-1", {
      source: "order",
      riskCode: "userRequested",
      region: "CN"
    });
    expect(prisma.crisisIntervention.create).toHaveBeenCalledTimes(1);
  });

  it("creates a critical chat gate inside the supplied transaction without message evidence", async () => {
    const { service } = build();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      crisisIntervention: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(record({
          source: "chatSafetyRule",
          riskCode: "selfHarmSignal"
        }))
      }
    };

    await expect(service.recordCriticalChatSignal(
      "authenticated-sender",
      { priority: "critical", categories: ["selfHarm"] },
      transaction as any
    )).resolves.toEqual(expect.objectContaining({
      source: "chatSafetyRule",
      riskCode: "selfHarmSignal"
    }));

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.crisisIntervention.create).toHaveBeenCalledWith({
      data: {
        userId: "authenticated-sender",
        source: "chatSafetyRule",
        riskCode: "selfHarmSignal",
        region: "CN",
        resourcePolicyVersion: "cn-emergency-resources-2026-08-01"
      }
    });
    const persisted = JSON.stringify(transaction.crisisIntervention.create.mock.calls[0][0]);
    expect(persisted).not.toMatch(/content|message|statement|body|target|recipient/i);
    expect(transaction.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(transaction.crisisIntervention.findFirst.mock.invocationCallOrder[0]);
    expect(transaction.crisisIntervention.findFirst.mock.invocationCallOrder[0])
      .toBeLessThan(transaction.crisisIntervention.create.mock.invocationCallOrder[0]);
  });

  it("does not persist non-critical or unrelated critical moderation categories", async () => {
    const { service } = build();
    const transaction = {
      $queryRaw: jest.fn(),
      crisisIntervention: { findFirst: jest.fn(), create: jest.fn() }
    };

    await expect(service.recordCriticalChatSignal(
      "user-1",
      { priority: "high", categories: ["selfHarm"] },
      transaction as any
    )).resolves.toBeNull();
    await expect(service.recordCriticalChatSignal(
      "user-1",
      { priority: "critical", categories: ["privateContact"] },
      transaction as any
    )).resolves.toBeNull();

    expect(transaction.$queryRaw).not.toHaveBeenCalled();
    expect(transaction.crisisIntervention.findFirst).not.toHaveBeenCalled();
    expect(transaction.crisisIntervention.create).not.toHaveBeenCalled();
  });

  it("recovers the unique-index winner when two pending creations race", async () => {
    const { prisma, service } = build();
    const uniqueRace = Object.assign(new Error("unique"), { code: "P2002" });
    prisma.$transaction.mockRejectedValueOnce(uniqueRace);
    prisma.crisisIntervention.findFirst.mockResolvedValue(record({
      id: "race-winner",
      source: "chatSafetyRule",
      riskCode: "violenceSignal"
    }));

    await expect(service.create("user-1", {
      source: "chatSafetyRule",
      riskCode: "violenceSignal",
      region: "CN"
    })).resolves.toEqual(expect.objectContaining({ id: "race-winner" }));

    expect(prisma.crisisIntervention.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", status: "resourcesPending" }
    }));
  });

  it("returns only owner-scoped records", async () => {
    const { prisma, service } = build();
    prisma.crisisIntervention.findFirst.mockResolvedValue(null);

    await expect(service.getOwned("other-user", "crisis-1")).rejects.toMatchObject({
      code: "CRISIS_INTERVENTION_NOT_FOUND",
      status: HttpStatus.NOT_FOUND
    });
    expect(prisma.crisisIntervention.findFirst).toHaveBeenCalledWith({
      where: { id: "crisis-1", userId: "other-user" }
    });
  });

  it("completes the resource view once and keeps repeat completion idempotent", async () => {
    const { prisma, service } = build();
    const completed = record({
      status: "resourcesViewed",
      resourcesViewedAt: new Date("2026-08-01T00:01:00.000Z"),
      updatedAt: new Date("2026-08-01T00:01:00.000Z")
    });
    prisma.crisisIntervention.findFirst
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(completed);
    prisma.crisisIntervention.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.completeResourceView("user-1", "crisis-1"))
      .resolves.toEqual(expect.objectContaining({ status: "resourcesViewed" }));
    await service.completeResourceView("user-1", "crisis-1");
    expect(prisma.crisisIntervention.updateMany).toHaveBeenCalledTimes(1);
  });

  it("fails order intake closed while an owned intervention is pending", async () => {
    const { prisma, service } = build();
    prisma.crisisIntervention.findFirst.mockResolvedValue(record());

    await expect(service.assertResourcesViewedBeforeOrder("user-1")).rejects.toMatchObject({
      code: "CRISIS_RESOURCES_MUST_BE_VIEWED",
      status: HttpStatus.CONFLICT,
      details: expect.objectContaining({ interventionId: "crisis-1" })
    });
    prisma.crisisIntervention.findFirst.mockResolvedValue(null);
    await expect(service.assertResourcesViewedBeforeOrder("user-1")).resolves.toBeUndefined();
  });

  it("shares a transaction-scoped user lock with the final order check", async () => {
    const { service } = build();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      crisisIntervention: { findFirst: jest.fn().mockResolvedValue(null) }
    };

    await expect(service.assertResourcesViewedBeforeOrder("user-1", transaction as any)).resolves.toBeUndefined();
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.crisisIntervention.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", status: "resourcesPending" }
    }));
  });
});
