import { AvailabilityReminderAttemptDeliveryService } from "./availability-reminder-attempt-delivery.service";

const NOW = new Date("2026-07-21T10:00:00.000Z");
const LEASE_TOKEN = "lease-token-1";

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    handoffId: "handoff-1",
    subscriptionGrantId: "grant-1",
    status: "readyToSend",
    outcomeReason: null,
    authorizationConsumedAt: new Date("2026-07-21T09:59:00.000Z"),
    sendLeaseToken: LEASE_TOKEN,
    sendLeaseExpiresAt: new Date("2026-07-21T10:05:00.000Z"),
    ...overrides
  };
}

function grant(overrides: Record<string, unknown> = {}) {
  return { id: "grant-1", userId: "customer-1", templateId: "tmpl-reminder", ...overrides };
}

function sendingAttempt(overrides: Record<string, unknown> = {}) {
  return attempt({ status: "sending", ...overrides });
}

describe("AvailabilityReminderAttemptDeliveryService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
    availabilityReminderAttempt: { findUnique: jest.fn(), updateMany: jest.fn() },
    availabilityReminderHandoff: { findUnique: jest.fn() },
    availabilityReminderCandidate: { findUnique: jest.fn() },
    companionFavorite: { findFirst: jest.fn(), updateMany: jest.fn() },
    weChatSubscriptionGrant: { findFirst: jest.fn() }
  } as any;
  prisma.$transaction = jest.fn((callback: (transaction: typeof prisma) => unknown) => callback(prisma));
  const provider = { send: jest.fn() } as any;
  const service = new AvailabilityReminderAttemptDeliveryService(prisma, provider);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt());
    prisma.availabilityReminderAttempt.updateMany.mockResolvedValue({ count: 1 });
    prisma.weChatSubscriptionGrant.findFirst.mockResolvedValue(grant());
    prisma.availabilityReminderHandoff.findUnique.mockResolvedValue({ candidateId: "candidate-1" });
    prisma.availabilityReminderCandidate.findUnique.mockResolvedValue({
      favoriteId: "favorite-1",
      companionId: "companion-1"
    });
    prisma.companionFavorite.findFirst.mockResolvedValue({ userId: "customer-1" });
    prisma.companionFavorite.updateMany.mockResolvedValue({ count: 1 });
  });

  it("claims a matching lease, calls the provider outside the transaction, and updates frequency only after confirmed send", async () => {
    prisma.availabilityReminderAttempt.findUnique
      .mockResolvedValueOnce(attempt())
      .mockResolvedValueOnce(sendingAttempt());
    provider.send.mockResolvedValue({
      outcome: "sent",
      attempted: true,
      remoteState: "accepted",
      providerMessageId: "wechat-message-1"
    });

    await expect(service.deliver("attempt-1", LEASE_TOKEN, NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "sent",
      reason: null
    });

    expect(provider.send).toHaveBeenCalledWith({
      userId: "customer-1",
      templateKey: "availabilityReminder",
      templateId: "tmpl-reminder",
      title: "你收藏的陪伴者有新的可约时段",
      body: "打开小程序查看当前可预约时段。",
      data: { companionId: "companion-1" }
    });
    expect(prisma.availabilityReminderCandidate.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: "candidate-1" },
      select: { favoriteId: true, companionId: true }
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction.mock.invocationCallOrder[0])
      .toBeLessThan(provider.send.mock.invocationCallOrder[0]);
    expect(provider.send.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.$transaction.mock.invocationCallOrder[1]);
    expect(prisma.weChatSubscriptionGrant.findFirst).toHaveBeenCalledWith({
      where: {
        id: "grant-1",
        userId: "customer-1",
        templateKey: "availabilityReminder",
        consumedAt: { not: null },
        consumedByDeliveryId: null,
        availabilityReminderAttempt: {
          is: { id: "attempt-1", handoffId: "handoff-1", status: "readyToSend" }
        }
      },
      select: { id: true, userId: true, templateId: true }
    });
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "attempt-1", status: "readyToSend", sendLeaseToken: LEASE_TOKEN },
      data: {
        status: "sending",
        providerAttemptStartedAt: NOW,
        providerResolvedAt: null,
        providerMessageId: null,
        providerErrorCode: null
      }
    });
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "attempt-1", status: "sending", sendLeaseToken: LEASE_TOKEN },
      data: expect.objectContaining({
        status: "sent",
        providerMessageId: "wechat-message-1",
        sendLeaseToken: null,
        sendLeaseExpiresAt: null
      })
    }));
    const sentAt = prisma.availabilityReminderAttempt.updateMany.mock.calls[1][0].data.providerResolvedAt;
    expect(prisma.companionFavorite.updateMany).toHaveBeenCalledWith({
      where: { id: "favorite-1" },
      data: { availabilityReminderLastDeliveredAt: sentAt }
    });
    expect(prisma.$queryRaw.mock.calls.map((call: any[]) => (call[0] as TemplateStringsArray).join(""))).toEqual([
      expect.stringContaining('FROM "AvailabilityReminderAttempt"'),
      expect.stringContaining('FROM "AvailabilityReminderHandoff"'),
      expect.stringContaining('FROM "AvailabilityReminderCandidate"'),
      expect.stringContaining('FROM "CompanionFavorite"'),
      expect.stringContaining('FROM "WeChatSubscriptionGrant"'),
      expect.stringContaining('FROM "AvailabilityReminderAttempt"'),
      expect.stringContaining('FROM "AvailabilityReminderHandoff"'),
      expect.stringContaining('FROM "AvailabilityReminderCandidate"'),
      expect.stringContaining('FROM "CompanionFavorite"')
    ]);
  });

  it.each([
    [
      "a provider skip",
      { outcome: "skipped", attempted: false, remoteState: "notAttempted", errorCode: "CHANNEL_DISABLED" },
      "skipped",
      "providerSkipped"
    ],
    [
      "an explicit provider rejection",
      { outcome: "failed", attempted: true, remoteState: "rejected", errorCode: "43101" },
      "rejected",
      "providerRejected"
    ],
    [
      "a confirmed pre-send failure",
      { outcome: "retryable", attempted: false, remoteState: "notAttempted", errorCode: "ACCESS_TOKEN_UNAVAILABLE" },
      "failedBeforeSend",
      "providerPreSendFailed"
    ],
    [
      "an unknown remote outcome",
      { outcome: "failed", attempted: true, remoteState: "unknown", errorCode: "DELIVERY_UNKNOWN" },
      "uncertain",
      "providerUnknown"
    ],
    [
      "an adapter-labeled skip with an unknown remote state",
      { outcome: "skipped", attempted: true, remoteState: "unknown", errorCode: "ADAPTER_AMBIGUITY" },
      "uncertain",
      "providerUnknown"
    ]
  ])("stores %s without claiming a customer-visible delivery", async (_label, outcome: any, decision, reason) => {
    prisma.availabilityReminderAttempt.findUnique
      .mockResolvedValueOnce(attempt())
      .mockResolvedValueOnce(sendingAttempt());
    provider.send.mockResolvedValue(outcome);

    await expect(service.deliver("attempt-1", LEASE_TOKEN, NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision,
      reason
    });

    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "attempt-1", status: "sending", sendLeaseToken: LEASE_TOKEN },
      data: expect.objectContaining({ status: decision, outcomeReason: reason, sendLeaseToken: null })
    }));
    expect(prisma.companionFavorite.updateMany).not.toHaveBeenCalled();
    if (decision === "uncertain") {
      expect(prisma.availabilityReminderAttempt.updateMany.mock.calls[1][0].data)
        .not.toHaveProperty("sendLeaseExpiresAt");
    } else {
      expect(prisma.availabilityReminderAttempt.updateMany.mock.calls[1][0].data.sendLeaseExpiresAt).toBeNull();
    }
  });

  it("does not call the provider or consume again when another caller holds the active lease", async () => {
    await expect(service.deliver("attempt-1", "wrong-token", NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "inFlight",
      reason: null
    });

    expect(prisma.weChatSubscriptionGrant.findFirst).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderAttempt.updateMany).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("does not cross the provider boundary after the customer disarms the exact reminder", async () => {
    prisma.companionFavorite.findFirst.mockResolvedValue(null);

    await expect(service.deliver("attempt-1", LEASE_TOKEN, NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "skipped",
      reason: "providerSkipped"
    });

    expect(prisma.companionFavorite.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "favorite-1",
        availabilityReminderEnabled: true,
        availabilityReminderGrantId: "grant-1"
      }),
      select: { userId: true }
    }));
    expect(prisma.weChatSubscriptionGrant.findFirst).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "attempt-1", status: "readyToSend", sendLeaseToken: LEASE_TOKEN },
      data: expect.objectContaining({ status: "skipped", outcomeReason: "providerSkipped" })
    }));
  });

  it("quarantines an expired lease before the provider boundary", async () => {
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(attempt({
      sendLeaseExpiresAt: new Date(NOW.getTime() - 1)
    }));

    await expect(service.deliver("attempt-1", LEASE_TOKEN, NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "uncertain",
      reason: "sendLeaseExpired"
    });

    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "attempt-1", status: "readyToSend", sendLeaseToken: LEASE_TOKEN },
      data: expect.objectContaining({ status: "uncertain", outcomeReason: "sendLeaseExpired", sendLeaseToken: null })
    }));
    expect(prisma.weChatSubscriptionGrant.findFirst).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("turns a provider throw into an unknown state and never updates delivery frequency", async () => {
    prisma.availabilityReminderAttempt.findUnique
      .mockResolvedValueOnce(attempt())
      .mockResolvedValueOnce(sendingAttempt());
    provider.send.mockRejectedValue(new Error("socket reset"));

    await expect(service.deliver("attempt-1", LEASE_TOKEN, NOW)).resolves.toEqual({
      attemptId: "attempt-1",
      decision: "uncertain",
      reason: "providerUnknown"
    });

    expect(prisma.companionFavorite.updateMany).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "uncertain",
        outcomeReason: "providerUnknown",
        providerErrorCode: "DELIVERY_UNKNOWN"
      })
    }));
  });

  it("rejects an absent or blank attempt before the provider can be called", async () => {
    prisma.availabilityReminderAttempt.findUnique.mockResolvedValue(null);

    await expect(service.deliver("attempt-1", LEASE_TOKEN, NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_ATTEMPT_NOT_FOUND", status: 404 });
    expect(provider.send).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await expect(service.deliver("   ", LEASE_TOKEN, NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_ATTEMPT_NOT_FOUND", status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
