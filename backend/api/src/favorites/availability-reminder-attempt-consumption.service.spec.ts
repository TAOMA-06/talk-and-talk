import {
  AVAILABILITY_REMINDER_SEND_LEASE_MS,
  AvailabilityReminderAttemptConsumptionService
} from "./availability-reminder-attempt-consumption.service";

const NOW = new Date("2026-07-21T09:00:00.000Z");

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    handoffId: "handoff-1",
    subscriptionGrantId: "grant-1",
    status: "reserved",
    outcomeReason: null,
    authorizationConsumedAt: null,
    sendLeaseToken: null,
    sendLeaseExpiresAt: null,
    ...overrides
  };
}

function liveEligible(grantId = "grant-1") {
  return {
    candidateId: "candidate-1",
    decision: "eligible",
    reason: null,
    preparation: {
      favoriteId: "favorite-1",
      userId: "customer-1",
      subscriptionGrantId: grantId,
      companionId: "companion-1",
      availabilityWindowId: "window-1"
    }
  };
}

describe("AvailabilityReminderAttemptConsumptionService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
    availabilityReminderAttempt: { findUnique: jest.fn(), updateMany: jest.fn() },
    availabilityReminderHandoff: { findUnique: jest.fn() },
    weChatSubscriptionGrant: { updateMany: jest.fn() }
  } as any;
  prisma.$transaction = jest.fn((callback: (transaction: typeof prisma) => unknown) => callback(prisma));
  const preflight = { recheckEligibleCandidateWithinTransaction: jest.fn() } as any;
  const service = new AvailabilityReminderAttemptConsumptionService(prisma, preflight);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt());
    prisma.availabilityReminderAttempt.updateMany.mockResolvedValue({ count: 1 });
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue({ id: "handoff-1", candidateId: "candidate-1" });
    prisma.weChatSubscriptionGrant.updateMany.mockResolvedValue({ count: 1 });
    preflight.recheckEligibleCandidateWithinTransaction.mockResolvedValue(liveEligible());
  });

  it("atomically consumes only the exact reserved grant and grants one private send lease", async () => {
    const result = await service.acquireFinalSendAuthorization("attempt-1", NOW);

    expect(result).toEqual({
      attemptId: "attempt-1",
      decision: "authorized",
      reason: null,
      sendLeaseToken: expect.any(String),
      sendLeaseExpiresAt: new Date(NOW.getTime() + AVAILABILITY_REMINDER_SEND_LEASE_MS).toISOString()
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$queryRaw.mock.calls.map((call: any[]) => (call[0] as TemplateStringsArray).join(""))).toEqual([
      expect.stringContaining('FROM "AvailabilityReminderAttempt"'),
      expect.stringContaining('FROM "AvailabilityReminderHandoff"')
    ]);
    expect(prisma.availabilityReminderHandoff.findUnique).toHaveBeenCalledWith({
      where: { id: "handoff-1" },
      select: { id: true, candidateId: true }
    });
    expect(preflight.recheckEligibleCandidateWithinTransaction).toHaveBeenCalledWith(prisma, "candidate-1", NOW);
    expect(prisma.weChatSubscriptionGrant.updateMany).toHaveBeenCalledWith({
      where: {
        id: "grant-1",
        consumedAt: null,
        availabilityReminderAttempt: {
          is: { id: "attempt-1", handoffId: "handoff-1", status: "reserved" }
        }
      },
      data: { consumedAt: NOW }
    });
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1", status: "reserved" },
      data: {
        status: "readyToSend",
        outcomeReason: null,
        authorizationConsumedAt: NOW,
        sendLeaseToken: expect.any(String),
        sendLeaseExpiresAt: new Date(NOW.getTime() + AVAILABILITY_REMINDER_SEND_LEASE_MS)
      }
    });
    expect(prisma.weChatSubscriptionGrant.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.availabilityReminderAttempt.updateMany.mock.invocationCallOrder[0]);
  });

  it("does not replay an active lease token, consume again, or rerun live eligibility", async () => {
    const expiresAt = new Date(NOW.getTime() + AVAILABILITY_REMINDER_SEND_LEASE_MS);
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({
      status: "readyToSend",
      authorizationConsumedAt: NOW,
      sendLeaseToken: "private-lease-token",
      sendLeaseExpiresAt: expiresAt
    }));

    await expect(service.acquireFinalSendAuthorization("attempt-1", NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "inFlight",
      reason: null,
      sendLeaseToken: null,
      sendLeaseExpiresAt: expiresAt.toISOString()
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.availabilityReminderHandoff.findUnique).not.toHaveBeenCalled();
    expect(preflight.recheckEligibleCandidateWithinTransaction).not.toHaveBeenCalled();
    expect(prisma.weChatSubscriptionGrant.updateMany).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("quarantines an expired lease without releasing or consuming an authorization again", async () => {
    const expiredAt = new Date(NOW.getTime() - 1);
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({
      status: "readyToSend",
      authorizationConsumedAt: new Date(NOW.getTime() - 60_000),
      sendLeaseToken: "private-lease-token",
      sendLeaseExpiresAt: expiredAt
    }));

    await expect(service.recoverExpiredSendLease("attempt-1", NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "recoveryRequired",
      reason: "sendLeaseExpired",
      sendLeaseToken: null,
      sendLeaseExpiresAt: expiredAt.toISOString()
    });

    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1", status: "readyToSend" },
      data: { status: "uncertain", outcomeReason: "sendLeaseExpired" }
    });
    expect(prisma.weChatSubscriptionGrant.updateMany).not.toHaveBeenCalled();
    expect(preflight.recheckEligibleCandidateWithinTransaction).not.toHaveBeenCalled();
  });

  it("also quarantines an expired lease after a provider boundary was claimed", async () => {
    const expiredAt = new Date(NOW.getTime() - 1);
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({
      status: "sending",
      authorizationConsumedAt: new Date(NOW.getTime() - 60_000),
      sendLeaseToken: "private-lease-token",
      sendLeaseExpiresAt: expiredAt
    }));

    await expect(service.recoverExpiredSendLease("attempt-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "recoveryRequired",
      reason: "sendLeaseExpired",
      sendLeaseExpiresAt: expiredAt.toISOString()
    }));
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1", status: "sending" },
      data: { status: "uncertain", outcomeReason: "sendLeaseExpired" }
    });
    expect(prisma.weChatSubscriptionGrant.updateMany).not.toHaveBeenCalled();
  });

  it("quarantines a malformed ready state instead of treating an unproven lease as in flight", async () => {
    const futureExpiry = new Date(NOW.getTime() + AVAILABILITY_REMINDER_SEND_LEASE_MS);
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({
      status: "readyToSend",
      authorizationConsumedAt: null,
      sendLeaseToken: null,
      sendLeaseExpiresAt: futureExpiry
    }));

    await expect(service.acquireFinalSendAuthorization("attempt-1", NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "recoveryRequired",
      reason: "sendLeaseExpired",
      sendLeaseToken: null,
      sendLeaseExpiresAt: futureExpiry.toISOString()
    });
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1", status: "readyToSend" },
      data: { status: "uncertain", outcomeReason: "sendLeaseExpired" }
    });
    expect(prisma.weChatSubscriptionGrant.updateMany).not.toHaveBeenCalled();
  });

  it("keeps terminal skip and uncertainty outcomes idempotent without touching the grant", async () => {
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({
      status: "skipped",
      outcomeReason: "availabilityUnavailable"
    }));

    await expect(service.acquireFinalSendAuthorization("attempt-1", NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "skipped",
      reason: "availabilityUnavailable",
      sendLeaseToken: null,
      sendLeaseExpiresAt: null
    });

    jest.clearAllMocks();
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({
      status: "uncertain",
      outcomeReason: "sendLeaseExpired",
      authorizationConsumedAt: new Date(NOW.getTime() - 60_000),
      sendLeaseExpiresAt: new Date(NOW.getTime() - 1)
    }));
    await expect(service.recoverExpiredSendLease("attempt-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "recoveryRequired",
      reason: "sendLeaseExpired"
    }));

    expect(prisma.availabilityReminderAttempt.updateMany).not.toHaveBeenCalled();
    expect(prisma.weChatSubscriptionGrant.updateMany).not.toHaveBeenCalled();
    expect(preflight.recheckEligibleCandidateWithinTransaction).not.toHaveBeenCalled();
  });

  it("records a generic skipped outcome when the same live check is no longer ready", async () => {
    preflight.recheckEligibleCandidateWithinTransaction.mockResolvedValue({
      candidateId: "candidate-1",
      decision: "skipped",
      reason: "rateLimited",
      preparation: null
    });

    await expect(service.acquireFinalSendAuthorization("attempt-1", NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "skipped",
      reason: "rateLimited",
      sendLeaseToken: null,
      sendLeaseExpiresAt: null
    });

    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1", status: "reserved" },
      data: { status: "skipped", outcomeReason: "rateLimited" }
    });
    expect(prisma.weChatSubscriptionGrant.updateMany).not.toHaveBeenCalled();
  });

  it("never consumes a different grant after the favorite's current binding changed", async () => {
    preflight.recheckEligibleCandidateWithinTransaction.mockResolvedValue(liveEligible("grant-2"));

    await expect(service.acquireFinalSendAuthorization("attempt-1", NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "skipped",
      reason: "authorizationUnavailable",
      sendLeaseToken: null,
      sendLeaseExpiresAt: null
    });

    expect(prisma.weChatSubscriptionGrant.updateMany).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1", status: "reserved" },
      data: { status: "skipped", outcomeReason: "authorizationUnavailable" }
    });
  });

  it("does not advance the attempt if the exact grant can no longer be atomically consumed", async () => {
    prisma.weChatSubscriptionGrant.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.acquireFinalSendAuthorization("attempt-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "authorizationUnavailable"
    }));

    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1", status: "reserved" },
      data: { status: "skipped", outcomeReason: "authorizationUnavailable" }
    });
  });

  it("turns a removed or unprepared candidate into a stored generic skip without consuming the grant", async () => {
    preflight.recheckEligibleCandidateWithinTransaction
      .mockRejectedValueOnce({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND" })
      .mockRejectedValueOnce({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_ELIGIBLE" });

    await expect(service.acquireFinalSendAuthorization("attempt-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "handoffUnavailable"
    }));
    await expect(service.acquireFinalSendAuthorization("attempt-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "preflightUnavailable"
    }));
    expect(prisma.weChatSubscriptionGrant.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an absent or blank attempt before it can consume a grant", async () => {
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(null);

    await expect(service.acquireFinalSendAuthorization("attempt-1", NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_ATTEMPT_NOT_FOUND", status: 404 });
    expect(prisma.weChatSubscriptionGrant.updateMany).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await expect(service.acquireFinalSendAuthorization("   ", NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_ATTEMPT_NOT_FOUND", status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
