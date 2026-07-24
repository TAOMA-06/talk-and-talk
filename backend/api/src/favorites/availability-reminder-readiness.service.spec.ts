import { AvailabilityReminderReadinessService } from "./availability-reminder-readiness.service";

const NOW = new Date("2026-07-21T08:00:00.000Z");

function handoff(overrides: Record<string, unknown> = {}) {
  return { id: "handoff-1", candidateId: "candidate-1", ...overrides };
}

describe("AvailabilityReminderReadinessService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
    availabilityReminderHandoff: { findUnique: jest.fn() }
  } as any;
  prisma.$transaction = jest.fn((callback: (transaction: typeof prisma) => unknown) => callback(prisma));
  const preflight = { recheckEligibleCandidate: jest.fn() } as any;
  const service = new AvailabilityReminderReadinessService(prisma, preflight);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue(handoff());
    preflight.recheckEligibleCandidate.mockResolvedValue({
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
    });
  });

  it("locks the inert handoff then returns a fresh, in-memory ready result from the shared live checker", async () => {
    await expect(service.prepare("handoff-1", NOW)).resolves.toEqual({
      handoffId: "handoff-1",
      decision: "ready",
      reason: null,
      preparation: {
        candidateId: "candidate-1",
        favoriteId: "favorite-1",
        userId: "customer-1",
        subscriptionGrantId: "grant-1",
        companionId: "companion-1",
        availabilityWindowId: "window-1"
      }
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.availabilityReminderHandoff.findUnique).toHaveBeenCalledWith({
      where: { id: "handoff-1" },
      select: { id: true, candidateId: true }
    });
    expect(preflight.recheckEligibleCandidate).toHaveBeenCalledWith("candidate-1", NOW);
  });

  it("returns only a generic skip when current live conditions no longer permit preparation", async () => {
    preflight.recheckEligibleCandidate.mockResolvedValue({
      candidateId: "candidate-1",
      decision: "skipped",
      reason: "rateLimited",
      preparation: null
    });

    await expect(service.prepare("handoff-1", NOW)).resolves.toEqual({
      handoffId: "handoff-1",
      decision: "skipped",
      reason: "rateLimited",
      preparation: null
    });
  });

  it("does not make an absent handoff look like a valid delivery candidate", async () => {
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue(null);

    await expect(service.prepare("handoff-1", NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_HANDOFF_NOT_FOUND", status: 404 });
    expect(preflight.recheckEligibleCandidate).not.toHaveBeenCalled();
  });

  it("handles a cascaded candidate disappearance as a generic stale handoff", async () => {
    preflight.recheckEligibleCandidate.mockRejectedValue({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND" });

    await expect(service.prepare("handoff-1", NOW)).resolves.toEqual({
      handoffId: "handoff-1",
      decision: "skipped",
      reason: "handoffUnavailable",
      preparation: null
    });
  });

  it("does not permit a handoff whose source is no longer an eligible preflight", async () => {
    preflight.recheckEligibleCandidate.mockRejectedValue({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_ELIGIBLE" });

    await expect(service.prepare("handoff-1", NOW)).resolves.toEqual({
      handoffId: "handoff-1",
      decision: "skipped",
      reason: "preflightUnavailable",
      preparation: null
    });
  });

  it("rejects a blank internal handoff id before opening a transaction", async () => {
    await expect(service.prepare("   ", NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_HANDOFF_NOT_FOUND", status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
