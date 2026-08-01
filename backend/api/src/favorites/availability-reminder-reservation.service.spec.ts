import { AvailabilityReminderReservationService } from "./availability-reminder-reservation.service";

const NOW = new Date("2026-08-01T08:00:00.000Z");

function createHarness(enabled = true) {
  const prisma = {
    $queryRaw: jest.fn(),
    availabilityReminderCandidate: {
      count: jest.fn(),
      findFirst: jest.fn()
    },
    availabilityReminderHandoff: {
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn()
    },
    availabilityReminderAttempt: {
      count: jest.fn(),
      findFirst: jest.fn()
    }
  } as any;
  prisma.$queryRaw.mockResolvedValue([]);
  prisma.availabilityReminderHandoff.updateMany.mockResolvedValue({ count: 1 });
  const attempts = { reserve: jest.fn() } as any;
  const config = {
    get: jest.fn((key: string) => key === "AVAILABILITY_REMINDER_PREPARATION_ENABLED" ? enabled : undefined)
  } as any;
  return {
    prisma,
    attempts,
    service: new AvailabilityReminderReservationService(prisma, attempts, config)
  };
}

describe("AvailabilityReminderReservationService", () => {
  it("walks a stable bounded pending batch and creates the attempts consumed by delivery", async () => {
    const { prisma, attempts, service } = createHarness();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "handoff-1", reservationFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "handoff-2", reservationFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "handoff-3", reservationFailureCount: 0 }]);
    attempts.reserve
      .mockResolvedValueOnce({ decision: "reserved", created: true, attemptId: "attempt-1" })
      .mockResolvedValueOnce({ decision: "reserved", created: false, attemptId: "attempt-2" })
      .mockResolvedValueOnce({ decision: "skipped", created: false, attemptId: null });

    await expect(service.reservePending(3, NOW)).resolves.toEqual({
      scanned: 3,
      reserved: 1,
      alreadyProcessed: 1,
      skipped: 1,
      disappeared: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    });
    expect(Array.from(prisma.$queryRaw.mock.calls[0][0] as string[]).join(""))
      .toContain("FOR UPDATE SKIP LOCKED");
    expect(attempts.reserve.mock.calls).toEqual([
      ["handoff-1", NOW],
      ["handoff-2", NOW],
      ["handoff-3", NOW]
    ]);
  });

  it("contains a handoff deleted after the id scan without hiding other errors", async () => {
    const { prisma, attempts, service } = createHarness();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "gone", reservationFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "kept", reservationFailureCount: 0 }]);
    attempts.reserve
      .mockRejectedValueOnce({ code: "AVAILABILITY_REMINDER_HANDOFF_NOT_FOUND" })
      .mockResolvedValueOnce({ decision: "reserved", created: true, attemptId: "attempt-1" });

    await expect(service.reservePending(2, NOW)).resolves.toMatchObject({
      scanned: 2,
      disappeared: 1,
      reserved: 1
    });

    attempts.reserve.mockReset().mockRejectedValue(new Error("database unavailable"));
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "handoff-1", reservationFailureCount: 0 }]);
    await expect(service.reservePending(1, NOW)).resolves.toMatchObject({ retryScheduled: 1, failed: 0 });
  });

  it("never reports an undrained handoff queue as clear", async () => {
    const active = createHarness(true);
    active.prisma.availabilityReminderCandidate.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.preparationLeaseToken && "not" in where.preparationLeaseToken ? 0 : 2));
    active.prisma.availabilityReminderCandidate.findFirst.mockResolvedValue({
      createdAt: new Date("2026-08-01T05:00:00.000Z")
    });
    active.prisma.availabilityReminderHandoff.count.mockImplementation(({ where }: any) => {
      if (where?.reservationLeaseToken && "not" in where.reservationLeaseToken) return Promise.resolve(0);
      if (where?.attempt?.isNot === null) return Promise.resolve(1);
      if (where?.reservationOutcomeReason?.not === null) return Promise.resolve(8);
      return Promise.resolve(12);
    });
    active.prisma.availabilityReminderAttempt.count.mockResolvedValue(0);
    active.prisma.availabilityReminderAttempt.findFirst.mockResolvedValue(null);
    active.prisma.availabilityReminderHandoff.findFirst.mockResolvedValue({
      createdAt: new Date("2026-08-01T06:00:00.000Z")
    });
    await expect(active.service.operationalReadiness(NOW)).resolves.toMatchObject({
      status: "attentionRequired",
      preparationRunnerEnabled: true,
      pendingCandidates: 2,
      pending: 12,
      pendingWithAttempt: 1,
      skipped: 8,
      oldestCreatedAt: "2026-08-01T05:00:00.000Z",
      backlogSlaBreached: true
    });

    const disabled = createHarness(false);
    disabled.prisma.availabilityReminderCandidate.count.mockResolvedValue(0);
    disabled.prisma.availabilityReminderCandidate.findFirst.mockResolvedValue(null);
    disabled.prisma.availabilityReminderHandoff.count.mockImplementation(({ where }: any) => {
      if (where?.reservationLeaseToken && "not" in where.reservationLeaseToken) return Promise.resolve(0);
      if (where?.attempt || where?.reservationOutcomeReason) return Promise.resolve(0);
      return Promise.resolve(1);
    });
    disabled.prisma.availabilityReminderAttempt.count.mockResolvedValue(0);
    disabled.prisma.availabilityReminderAttempt.findFirst.mockResolvedValue(null);
    disabled.prisma.availabilityReminderHandoff.findFirst.mockResolvedValue({ createdAt: NOW });
    await expect(disabled.service.operationalReadiness(NOW)).resolves.toMatchObject({
      status: "attentionRequired",
      preparationRunnerEnabled: false,
      pending: 1,
      preparationRunnerDisabledWithDueBacklog: true
    });
  });

  it("keeps fresh future backlog diagnostic-only and blocks expired preparation claims", async () => {
    const fresh = createHarness(true);
    fresh.prisma.availabilityReminderCandidate.count.mockImplementation(({ where }: any) => {
      if (where?.preparationFailedAt && "not" in where.preparationFailedAt) {
        return Promise.resolve(0);
      }
      if (where?.preparationLeaseToken && "not" in where.preparationLeaseToken) {
        return Promise.resolve(0);
      }
      return Promise.resolve(where?.preparationNextAttemptAt ? 0 : 3);
    });
    fresh.prisma.availabilityReminderHandoff.count.mockResolvedValue(0);
    fresh.prisma.availabilityReminderAttempt.count.mockResolvedValue(0);
    fresh.prisma.availabilityReminderCandidate.findFirst.mockResolvedValue(null);
    fresh.prisma.availabilityReminderHandoff.findFirst.mockResolvedValue(null);
    fresh.prisma.availabilityReminderAttempt.findFirst.mockResolvedValue(null);

    await expect(fresh.service.operationalReadiness(NOW)).resolves.toMatchObject({
      status: "processing",
      pendingCandidates: 3,
      dueCandidates: 0,
      expiredPreparationLeases: 0,
      backlogSlaBreached: false
    });

    const expired = createHarness(true);
    expired.prisma.availabilityReminderCandidate.count.mockImplementation(({ where }: any) => {
      if (where?.preparationFailedAt && "not" in where.preparationFailedAt) return Promise.resolve(0);
      return Promise.resolve(
        where?.preparationLeaseToken && "not" in where.preparationLeaseToken ? 2 : 0
      );
    });
    expired.prisma.availabilityReminderHandoff.count.mockImplementation(({ where }: any) => {
      if (where?.reservationFailedAt && "not" in where.reservationFailedAt) return Promise.resolve(0);
      return Promise.resolve(
        where?.reservationLeaseToken && "not" in where.reservationLeaseToken ? 1 : 0
      );
    });
    expired.prisma.availabilityReminderAttempt.count.mockResolvedValue(0);
    expired.prisma.availabilityReminderCandidate.findFirst.mockResolvedValue(null);
    expired.prisma.availabilityReminderHandoff.findFirst.mockResolvedValue(null);
    expired.prisma.availabilityReminderAttempt.findFirst.mockResolvedValue(null);

    await expect(expired.service.operationalReadiness(NOW)).resolves.toMatchObject({
      status: "attentionRequired",
      expiredPreparationLeases: 2,
      expiredReservationLeases: 1
    });
  });

  it("surfaces delivery backlog, expired leases, and terminal provider uncertainty", async () => {
    const { prisma, service } = createHarness(true);
    prisma.availabilityReminderCandidate.count.mockResolvedValue(0);
    prisma.availabilityReminderCandidate.findFirst.mockResolvedValue(null);
    prisma.availabilityReminderHandoff.count.mockResolvedValue(0);
    prisma.availabilityReminderHandoff.findFirst.mockResolvedValue(null);
    prisma.availabilityReminderAttempt.count.mockImplementation(({ where }: any) => {
      if (where?.status === "reserved") return Promise.resolve(4);
      if (where?.status?.in) return Promise.resolve(where?.OR ? 1 : 2);
      if (where?.AND) return Promise.resolve(4);
      if (where?.deliveryClaimToken && "not" in where.deliveryClaimToken) return Promise.resolve(1);
      if (where?.deliveryFailedAt && "not" in where.deliveryFailedAt) return Promise.resolve(0);
      const unresolved = where?.operationalResolvedAt === null;
      if (where?.status === "failedBeforeSend") return Promise.resolve(unresolved ? 3 : 2);
      if (where?.status === "rejected") return Promise.resolve(unresolved ? 5 : 1);
      if (where?.status === "uncertain") return Promise.resolve(unresolved ? 7 : 4);
      return Promise.resolve(0);
    });
    prisma.availabilityReminderAttempt.findFirst.mockResolvedValue({
      createdAt: new Date("2026-08-01T04:00:00.000Z")
    });

    await expect(service.operationalReadiness(NOW)).resolves.toMatchObject({
      status: "attentionRequired",
      deliveryRunnerEnabled: false,
      reservedAttempts: 4,
      activeAttempts: 2,
      dueAttempts: 4,
      expiredAttemptLeases: 1,
      expiredDeliveryClaimLeases: 1,
      failedBeforeSend: 3,
      rejected: 5,
      uncertain: 7,
      terminalAttempts: {
        total: 22,
        resolved: 7,
        unresolved: 15,
        byStatus: {
          failedBeforeSend: { total: 5, resolved: 2, unresolved: 3 },
          rejected: { total: 6, resolved: 1, unresolved: 5 },
          uncertain: { total: 11, resolved: 4, unresolved: 7 }
        }
      },
      oldestCreatedAt: "2026-08-01T04:00:00.000Z"
    });
  });

  it("retains resolved provider history without letting it block readiness", async () => {
    const { prisma, service } = createHarness(true);
    prisma.availabilityReminderCandidate.count.mockResolvedValue(0);
    prisma.availabilityReminderCandidate.findFirst.mockResolvedValue(null);
    prisma.availabilityReminderHandoff.count.mockResolvedValue(0);
    prisma.availabilityReminderHandoff.findFirst.mockResolvedValue(null);
    prisma.availabilityReminderAttempt.count.mockImplementation(({ where }: any) => {
      if (where?.operationalResolvedAt?.not === null) {
        if (where.status === "failedBeforeSend") return Promise.resolve(2);
        if (where.status === "rejected") return Promise.resolve(3);
        if (where.status === "uncertain") return Promise.resolve(4);
      }
      return Promise.resolve(0);
    });
    prisma.availabilityReminderAttempt.findFirst.mockResolvedValue(null);

    await expect(service.operationalReadiness(NOW)).resolves.toMatchObject({
      status: "clear",
      failedBeforeSend: 0,
      rejected: 0,
      uncertain: 0,
      terminalAttempts: {
        total: 9,
        resolved: 9,
        unresolved: 0
      }
    });
  });
});
