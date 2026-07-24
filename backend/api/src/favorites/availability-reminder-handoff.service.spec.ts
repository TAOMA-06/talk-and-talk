import { AvailabilityReminderHandoffService } from "./availability-reminder-handoff.service";

const PREFLIGHTED_AT = new Date("2026-07-21T08:00:00.000Z");
const CREATED_AT = new Date("2026-07-21T08:01:00.000Z");

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1",
    preflightDecision: "eligible",
    preflightedAt: PREFLIGHTED_AT,
    ...overrides
  };
}

function handoff(overrides: Record<string, unknown> = {}) {
  return {
    id: "handoff-1",
    candidateId: "candidate-1",
    createdAt: CREATED_AT,
    ...overrides
  };
}

describe("AvailabilityReminderHandoffService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
    availabilityReminderCandidate: { findUnique: jest.fn() },
    availabilityReminderHandoff: { findUnique: jest.fn(), create: jest.fn() }
  } as any;
  prisma.$transaction = jest.fn((callback: (transaction: typeof prisma) => unknown) => callback(prisma));
  const service = new AvailabilityReminderHandoffService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.availabilityReminderCandidate.findUnique.mockResolvedValue(candidate());
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue(null);
    prisma.availabilityReminderHandoff.create.mockResolvedValue(handoff());
  });

  it("creates one minimal internal handoff for an eligible, finalized preflight candidate", async () => {
    await expect(service.createForEligibleCandidate("candidate-1")).resolves.toEqual({
      handoffId: "handoff-1",
      candidateId: "candidate-1",
      created: true,
      createdAt: CREATED_AT.toISOString()
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.availabilityReminderCandidate.findUnique).toHaveBeenCalledWith({
      where: { id: "candidate-1" },
      select: { id: true, preflightDecision: true, preflightedAt: true }
    });
    expect(prisma.availabilityReminderHandoff.findUnique).toHaveBeenCalledWith({
      where: { candidateId: "candidate-1" },
      select: { id: true, candidateId: true, createdAt: true }
    });
    expect(prisma.availabilityReminderHandoff.create).toHaveBeenCalledWith({
      data: { candidateId: "candidate-1" },
      select: { id: true, candidateId: true, createdAt: true }
    });
  });

  it("returns the original handoff on a repeated request without making another row", async () => {
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue(handoff());

    await expect(service.createForEligibleCandidate("candidate-1")).resolves.toEqual({
      handoffId: "handoff-1",
      candidateId: "candidate-1",
      created: false,
      createdAt: CREATED_AT.toISOString()
    });

    expect(prisma.availabilityReminderHandoff.create).not.toHaveBeenCalled();
  });

  it.each([
    ["pending", PREFLIGHTED_AT],
    ["skipped", PREFLIGHTED_AT],
    ["eligible", null]
  ])("rejects a %s candidate that has not completed an eligible preflight", async (preflightDecision, preflightedAt) => {
    prisma.availabilityReminderCandidate.findUnique.mockResolvedValue(candidate({ preflightDecision, preflightedAt }));

    await expect(service.createForEligibleCandidate("candidate-1"))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_ELIGIBLE", status: 409 });

    expect(prisma.availabilityReminderHandoff.findUnique).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderHandoff.create).not.toHaveBeenCalled();
  });

  it("does not treat a missing candidate as eligible", async () => {
    prisma.availabilityReminderCandidate.findUnique.mockResolvedValue(null);

    await expect(service.createForEligibleCandidate("candidate-1"))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND", status: 404 });
    expect(prisma.availabilityReminderHandoff.findUnique).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderHandoff.create).not.toHaveBeenCalled();
  });

  it("recovers idempotently if an out-of-band concurrent write wins the unique key", async () => {
    prisma.availabilityReminderHandoff.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(handoff({ id: "handoff-raced" }));
    prisma.availabilityReminderHandoff.create.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" }));

    await expect(service.createForEligibleCandidate("candidate-1")).resolves.toEqual({
      handoffId: "handoff-raced",
      candidateId: "candidate-1",
      created: false,
      createdAt: CREATED_AT.toISOString()
    });
  });

  it("does not create a permissive blank-id internal path", async () => {
    await expect(service.createForEligibleCandidate("   "))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND", status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
