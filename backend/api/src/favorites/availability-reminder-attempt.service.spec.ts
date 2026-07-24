import { AvailabilityReminderAttemptService } from "./availability-reminder-attempt.service";

const NOW = new Date("2026-07-21T08:00:00.000Z");
const RESERVED_AT = new Date("2026-07-21T08:00:01.000Z");

function handoff(overrides: Record<string, unknown> = {}) {
  return { id: "handoff-1", candidateId: "candidate-1", ...overrides };
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    handoffId: "handoff-1",
    status: "reserved",
    outcomeReason: null,
    createdAt: RESERVED_AT,
    ...overrides
  };
}

function liveEligible() {
  return {
    candidateId: "candidate-1",
    decision: "eligible",
    reason: null,
    preparation: {
      favoriteId: "favorite-1",
      userId: "customer-1",
      subscriptionGrantId: "grant-1",
      companionId: "companion-1",
      availabilityWindowId: "window-1"
    }
  };
}

describe("AvailabilityReminderAttemptService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
    availabilityReminderHandoff: { findUnique: jest.fn() },
    availabilityReminderAttempt: { findUnique: jest.fn(), create: jest.fn() }
  } as any;
  prisma.$transaction = jest.fn((callback: (transaction: typeof prisma) => unknown) => callback(prisma));
  const preflight = { recheckEligibleCandidateWithinTransaction: jest.fn() } as any;
  const service = new AvailabilityReminderAttemptService(prisma, preflight);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue(handoff());
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(null);
    prisma.availabilityReminderAttempt.create.mockResolvedValue(attempt());
    preflight.recheckEligibleCandidateWithinTransaction.mockResolvedValue(liveEligible());
  });

  it("atomically binds an eligible live grant to one durable, private reservation without consuming it", async () => {
    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual({
      handoffId: "handoff-1",
      decision: "reserved",
      reason: null,
      attemptId: "attempt-1",
      created: true,
      reservedAt: RESERVED_AT.toISOString()
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.availabilityReminderHandoff.findUnique).toHaveBeenCalledWith({
      where: { id: "handoff-1" },
      select: { id: true, candidateId: true }
    });
    expect(preflight.recheckEligibleCandidateWithinTransaction).toHaveBeenCalledWith(prisma, "candidate-1", NOW);
    expect(prisma.availabilityReminderAttempt.create).toHaveBeenCalledWith({
      data: { handoffId: "handoff-1", subscriptionGrantId: "grant-1" },
      select: { id: true, handoffId: true, status: true, createdAt: true }
    });
  });

  it("returns the existing reservation without rechecking or creating another binding", async () => {
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt());

    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "reserved",
      attemptId: "attempt-1",
      created: false
    }));

    expect(preflight.recheckEligibleCandidateWithinTransaction).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderAttempt.create).not.toHaveBeenCalled();
  });

  it("does not misreport a later consumed or quarantined attempt as a fresh reservation", async () => {
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({
      status: "readyToSend",
      outcomeReason: null
    }));

    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "readyToSend",
      attemptId: "attempt-1",
      created: false
    }));

    jest.clearAllMocks();
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue(handoff());
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({
      status: "uncertain",
      outcomeReason: "sendLeaseExpired"
    }));
    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "recoveryRequired",
      reason: "sendLeaseExpired",
      attemptId: "attempt-1"
    }));

    jest.clearAllMocks();
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue(handoff());
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({ status: "sent", outcomeReason: null }));
    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "sent",
      attemptId: "attempt-1",
      created: false
    }));
    expect(preflight.recheckEligibleCandidateWithinTransaction).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderAttempt.create).not.toHaveBeenCalled();
  });

  it("does not create a reservation when the shared live check no longer permits delivery", async () => {
    preflight.recheckEligibleCandidateWithinTransaction.mockResolvedValue({
      candidateId: "candidate-1",
      decision: "skipped",
      reason: "rateLimited",
      preparation: null
    });

    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual({
      handoffId: "handoff-1",
      decision: "skipped",
      reason: "rateLimited",
      attemptId: null,
      created: false,
      reservedAt: null
    });
    expect(prisma.availabilityReminderAttempt.create).not.toHaveBeenCalled();
  });

  it("does not disclose another handoff when the exact grant is already privately reserved", async () => {
    prisma.availabilityReminderAttempt.create.mockRejectedValue(Object.assign(new Error("duplicate grant"), { code: "P2002" }));
    prisma.availabilityReminderAttempt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "authorizationUnavailable",
      attemptId: null
    }));
  });

  it("recovers idempotently if an out-of-band writer created this handoff's reservation", async () => {
    prisma.availabilityReminderAttempt.create.mockRejectedValue(Object.assign(new Error("duplicate handoff"), { code: "P2002" }));
    prisma.availabilityReminderAttempt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(attempt({ id: "attempt-raced" }));

    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "reserved",
      attemptId: "attempt-raced",
      created: false
    }));
  });

  it("maps a removed or no-longer-eligible candidate to a generic non-reserved result", async () => {
    preflight.recheckEligibleCandidateWithinTransaction
      .mockRejectedValueOnce({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND" })
      .mockRejectedValueOnce({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_ELIGIBLE" });

    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "handoffUnavailable"
    }));
    await expect(service.reserve("handoff-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "preflightUnavailable"
    }));
  });

  it("rejects an absent or blank handoff before any reservation can be created", async () => {
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue(null);
    await expect(service.reserve("handoff-1", NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_HANDOFF_NOT_FOUND", status: 404 });
    expect(prisma.availabilityReminderAttempt.create).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await expect(service.reserve("   ", NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_HANDOFF_NOT_FOUND", status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
