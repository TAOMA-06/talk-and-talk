import { AvailabilityReminderPreparationService } from "./availability-reminder-preparation.service";

const NOW = new Date("2026-07-21T08:00:00.000Z");

describe("AvailabilityReminderPreparationService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
    availabilityReminderCandidate: { updateMany: jest.fn() }
  } as any;
  const preflight = { evaluate: jest.fn() } as any;
  const handoffs = { createForEligibleCandidate: jest.fn() } as any;
  const service = new AvailabilityReminderPreparationService(prisma, preflight, handoffs);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.availabilityReminderCandidate.updateMany.mockResolvedValue({ count: 1 });
  });

  it("reads only a bounded candidate-id batch, preflights sequentially, and hands off only eligible results", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "candidate-a", preparationFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "candidate-b", preparationFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "candidate-c", preparationFailureCount: 0 }])
      .mockResolvedValueOnce([]);
    const callOrder: string[] = [];
    preflight.evaluate.mockImplementation(async (candidateId: string) => {
      callOrder.push(`preflight:${candidateId}`);
      if (candidateId === "candidate-b") {
        return { candidateId, decision: "skipped", reason: "rateLimited", decidedAt: NOW.toISOString() };
      }
      return { candidateId, decision: "eligible", reason: null, decidedAt: NOW.toISOString() };
    });
    handoffs.createForEligibleCandidate
      .mockImplementationOnce(async (candidateId: string) => {
        callOrder.push(`handoff:${candidateId}`);
        return { handoffId: "handoff-a", candidateId, created: true, createdAt: NOW.toISOString() };
      })
      .mockImplementationOnce(async (candidateId: string) => {
        callOrder.push(`handoff:${candidateId}`);
        return { handoffId: "handoff-c", candidateId, created: false, createdAt: NOW.toISOString() };
      });

    await expect(service.preparePending(undefined, NOW)).resolves.toEqual({
      scanned: 3,
      eligible: 2,
      skipped: 1,
      handedOff: 1,
      alreadyHandedOff: 1,
      disappeared: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    });

    const claimSql = Array.from(prisma.$queryRaw.mock.calls[0][0] as string[]).join("");
    expect(claimSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(claimSql).toContain("preparationNextAttemptAt");
    expect(callOrder).toEqual([
      "preflight:candidate-a",
      "handoff:candidate-a",
      "preflight:candidate-b",
      "preflight:candidate-c",
      "handoff:candidate-c"
    ]);
  });

  it("includes an eligible candidate without a handoff so an interrupted earlier pass can recover", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{
      id: "eligible-without-handoff", preparationFailureCount: 0
    }]);
    preflight.evaluate.mockResolvedValue({
      candidateId: "eligible-without-handoff",
      decision: "eligible",
      reason: null,
      decidedAt: NOW.toISOString()
    });
    handoffs.createForEligibleCandidate.mockResolvedValue({
      handoffId: "handoff-1",
      candidateId: "eligible-without-handoff",
      created: true,
      createdAt: NOW.toISOString()
    });

    await expect(service.preparePending(1, NOW)).resolves.toEqual(expect.objectContaining({
      scanned: 1,
      eligible: 1,
      handedOff: 1
    }));
    expect(handoffs.createForEligibleCandidate).toHaveBeenCalledWith("eligible-without-handoff");
  });

  it("keeps the batch bounded even when an internal caller supplies an extreme or invalid limit", async () => {
    await service.preparePending(1_000, NOW);
    await service.preparePending(Number.NaN, NOW);
    await service.preparePending(0, NOW);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    for (const call of prisma.$queryRaw.mock.calls) {
      expect(Array.from(call[0] as string[]).join("")).toContain("LIMIT 1");
    }
  });

  it("treats a candidate deleted after the id scan as a safe no-op and continues", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "gone", preparationFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "still-here", preparationFailureCount: 0 }]);
    preflight.evaluate
      .mockRejectedValueOnce({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND" })
      .mockResolvedValueOnce({ candidateId: "still-here", decision: "eligible", reason: null, decidedAt: NOW.toISOString() });
    handoffs.createForEligibleCandidate.mockResolvedValue({
      handoffId: "handoff-1",
      candidateId: "still-here",
      created: true,
      createdAt: NOW.toISOString()
    });

    await expect(service.preparePending(2, NOW)).resolves.toEqual({
      scanned: 2,
      eligible: 1,
      skipped: 0,
      handedOff: 1,
      alreadyHandedOff: 0,
      disappeared: 1,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    });
    expect(handoffs.createForEligibleCandidate).toHaveBeenCalledTimes(1);
  });

  it("backs off a poison candidate without blocking the rest of the queue", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "candidate-1", preparationFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "candidate-2", preparationFailureCount: 0 }]);
    preflight.evaluate.mockRejectedValue(new Error("database unavailable"));

    await expect(service.preparePending(2, NOW)).resolves.toMatchObject({
      scanned: 2,
      retryScheduled: 2,
      failed: 0
    });
    expect(handoffs.createForEligibleCandidate).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderCandidate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        preparationFailureCount: 1,
        preparationFailedAt: null,
        preparationNextAttemptAt: new Date(NOW.getTime() + 5_000)
      })
    }));
  });
});
