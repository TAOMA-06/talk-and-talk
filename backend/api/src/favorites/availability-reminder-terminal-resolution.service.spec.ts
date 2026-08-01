import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { AvailabilityReminderTerminalResolutionService } from "./availability-reminder-terminal-resolution.service";
import { ResolveAvailabilityReminderTerminalDto } from "./dto/resolve-availability-reminder-terminal.dto";

const NOW = new Date("2026-08-01T09:00:00.000Z");

function terminalAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    status: "uncertain",
    operationalResolvedAt: null,
    operationalResolvedById: null,
    operationalResolutionCode: null,
    operationalResolutionNote: null,
    operationalEvidenceRef: null,
    subscriptionGrant: { userId: "user-1" },
    handoff: { candidate: { companion: { ownerUserId: "companion-owner-1" } } },
    ...overrides
  };
}

function createHarness() {
  const prisma = {
    $queryRaw: jest.fn(),
    availabilityReminderAttempt: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  } as any;
  prisma.$transaction = jest.fn((callback: (database: typeof prisma) => unknown) => callback(prisma));
  const audit = { record: jest.fn() } as any;
  return {
    prisma,
    audit,
    service: new AvailabilityReminderTerminalResolutionService(prisma, audit)
  };
}

describe("AvailabilityReminderTerminalResolutionService", () => {
  it("records an audited reconciliation while leaving every provider fact untouched", async () => {
    const { prisma, audit, service } = createHarness();
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(terminalAttempt());
    prisma.availabilityReminderAttempt.update.mockResolvedValue(terminalAttempt({
      operationalResolvedAt: NOW,
      operationalResolvedById: "operator-1",
      operationalResolutionCode: "uncertainProviderStateReconciled",
      operationalResolutionNote: "Provider dashboard checked",
      operationalEvidenceRef: "ops://incident/REM-1"
    }));

    await expect(service.resolve("operator-1", "attempt-1", {
      resolutionCode: "uncertainProviderStateReconciled",
      note: " Provider dashboard checked ",
      evidenceRef: " ops://incident/REM-1 "
    }, NOW)).resolves.toEqual({
      id: "attempt-1",
      terminalStatus: "uncertain",
      resolved: true,
      idempotent: false,
      automaticResend: false,
      operationalResolvedAt: NOW.toISOString(),
      operationalResolvedById: "operator-1",
      resolutionCode: "uncertainProviderStateReconciled",
      note: "Provider dashboard checked",
      evidenceRef: "ops://incident/REM-1"
    });

    expect(prisma.availabilityReminderAttempt.update).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: {
        operationalResolvedAt: NOW,
        operationalResolvedById: "operator-1",
        operationalResolutionCode: "uncertainProviderStateReconciled",
        operationalResolutionNote: "Provider dashboard checked",
        operationalEvidenceRef: "ops://incident/REM-1"
      },
      select: {
        id: true,
        status: true,
        operationalResolvedAt: true,
        operationalResolvedById: true,
        operationalResolutionCode: true,
        operationalResolutionNote: true,
        operationalEvidenceRef: true
      }
    });
    const resolutionWrite = prisma.availabilityReminderAttempt.update.mock.calls[0][0].data;
    expect(resolutionWrite).not.toHaveProperty("status");
    expect(resolutionWrite).not.toHaveProperty("outcomeReason");
    expect(resolutionWrite).not.toHaveProperty("providerResolvedAt");
    expect(resolutionWrite).not.toHaveProperty("providerMessageId");
    expect(resolutionWrite).not.toHaveProperty("providerErrorCode");
    expect(resolutionWrite).not.toHaveProperty("sendLeaseToken");
    expect(audit.record).toHaveBeenCalledWith({
      actorId: "operator-1",
      subjectUserIds: ["user-1", "companion-owner-1"],
      action: "availability_reminder.terminal_attempt_resolved",
      resourceType: "availabilityReminderAttempt",
      resourceId: "attempt-1",
      metadata: {
        terminalStatus: "uncertain",
        resolutionCode: "uncertainProviderStateReconciled",
        hasNote: true,
        hasEvidenceRef: true,
        automaticResend: false
      }
    }, prisma);
  });

  it("is idempotent only for the exact retained resolution", async () => {
    const { prisma, audit, service } = createHarness();
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(terminalAttempt({
      status: "rejected",
      operationalResolvedAt: NOW,
      operationalResolvedById: "operator-1",
      operationalResolutionCode: "providerRejectedReviewed",
      operationalResolutionNote: "No retry",
      operationalEvidenceRef: null
    }));

    await expect(service.resolve("operator-2", "attempt-1", {
      resolutionCode: "providerRejectedReviewed",
      note: "No retry"
    }, new Date(NOW.getTime() + 1_000))).resolves.toMatchObject({
      idempotent: true,
      automaticResend: false,
      operationalResolvedById: "operator-1"
    });
    expect(prisma.availabilityReminderAttempt.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    await expect(service.resolve("operator-2", "attempt-1", {
      resolutionCode: "providerRejectedReviewed",
      note: "Changed note"
    }, NOW)).rejects.toMatchObject({
      code: "AVAILABILITY_REMINDER_ATTEMPT_ALREADY_RESOLVED",
      status: 409
    });
  });

  it.each([
    ["reserved", "failedBeforeSendReviewed", "AVAILABILITY_REMINDER_ATTEMPT_NOT_TERMINAL"],
    ["failedBeforeSend", "providerRejectedReviewed", "AVAILABILITY_REMINDER_RESOLUTION_CODE_MISMATCH"],
    ["rejected", "uncertainProviderStateReconciled", "AVAILABILITY_REMINDER_RESOLUTION_CODE_MISMATCH"]
  ])("rejects status %s with incompatible resolution %s", async (status, resolutionCode, code) => {
    const { prisma, audit, service } = createHarness();
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(terminalAttempt({ status }));

    await expect(service.resolve("operator-1", "attempt-1", {
      resolutionCode: resolutionCode as any
    }, NOW)).rejects.toMatchObject({ code, status: 409 });
    expect(prisma.availabilityReminderAttempt.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("ResolveAvailabilityReminderTerminalDto", () => {
  it("accepts a controlled evidence reference and rejects raw secrets in the note", async () => {
    const safe = plainToInstance(ResolveAvailabilityReminderTerminalDto, {
      resolutionCode: "failedBeforeSendReviewed",
      note: " Reviewed against masked provider record ",
      evidenceRef: "ops://incident/REM-2"
    });
    await expect(validate(safe)).resolves.toHaveLength(0);
    expect(safe.note).toBe("Reviewed against masked provider record");

    const unsafe = plainToInstance(ResolveAvailabilityReminderTerminalDto, {
      resolutionCode: "failedBeforeSendReviewed",
      note: "access_token=abcdefghijklmnopqrstuvwxyz",
      evidenceRef: "ops://incident/REM-2"
    });
    const errors = await validate(unsafe);
    expect(errors.some((error) => error.property === "note"
      && Boolean(error.constraints?.isSafeOperationalText))).toBe(true);
  });

  it("rejects arbitrary evidence text and an unknown resolution code", async () => {
    const value = plainToInstance(ResolveAvailabilityReminderTerminalDto, {
      resolutionCode: "resent",
      evidenceRef: "provider dashboard says sent"
    });
    const errors = await validate(value);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      "resolutionCode",
      "evidenceRef"
    ]));
  });
});
