import { AvailabilityReminderPreparationService } from "./availability-reminder-preparation.service";

const NOW = new Date("2026-07-21T08:00:00.000Z");

describe("AvailabilityReminderPreparationService", () => {
  const prisma = {
    availabilityReminderCandidate: { findMany: jest.fn() }
  } as any;
  const preflight = { evaluate: jest.fn() } as any;
  const handoffs = { createForEligibleCandidate: jest.fn() } as any;
  const service = new AvailabilityReminderPreparationService(prisma, preflight, handoffs);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.availabilityReminderCandidate.findMany.mockResolvedValue([]);
  });

  it("reads only a bounded candidate-id batch, preflights sequentially, and hands off only eligible results", async () => {
    prisma.availabilityReminderCandidate.findMany.mockResolvedValue([
      { id: "candidate-a" },
      { id: "candidate-b" },
      { id: "candidate-c" }
    ]);
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
      disappeared: 0
    });

    expect(prisma.availabilityReminderCandidate.findMany).toHaveBeenCalledWith({
      where: {
        handoff: null,
        preflightDecision: { in: ["pending", "eligible"] }
      },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 20
    });
    expect(callOrder).toEqual([
      "preflight:candidate-a",
      "handoff:candidate-a",
      "preflight:candidate-b",
      "preflight:candidate-c",
      "handoff:candidate-c"
    ]);
  });

  it("includes an eligible candidate without a handoff so an interrupted earlier pass can recover", async () => {
    prisma.availabilityReminderCandidate.findMany.mockResolvedValue([{ id: "eligible-without-handoff" }]);
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

    expect(prisma.availabilityReminderCandidate.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ take: 100 }));
    expect(prisma.availabilityReminderCandidate.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 20 }));
    expect(prisma.availabilityReminderCandidate.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({ take: 1 }));
  });

  it("treats a candidate deleted after the id scan as a safe no-op and continues", async () => {
    prisma.availabilityReminderCandidate.findMany.mockResolvedValue([{ id: "gone" }, { id: "still-here" }]);
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
      disappeared: 1
    });
    expect(handoffs.createForEligibleCandidate).toHaveBeenCalledTimes(1);
  });

  it("does not silently bypass a non-race preflight failure", async () => {
    prisma.availabilityReminderCandidate.findMany.mockResolvedValue([{ id: "candidate-1" }]);
    preflight.evaluate.mockRejectedValue(new Error("database unavailable"));

    await expect(service.preparePending(1, NOW)).rejects.toThrow("database unavailable");
    expect(handoffs.createForEligibleCandidate).not.toHaveBeenCalled();
  });
});
