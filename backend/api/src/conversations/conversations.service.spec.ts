import { ConversationsService } from "./conversations.service";

describe("ConversationsService.ensureConversation", () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn()
    },
    companionProfile: {
      findFirst: jest.fn()
    },
    order: {
      findMany: jest.fn()
    },
    message: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn()
    },
    conversationNotificationPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn()
    },
    conversationBlock: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn()
    },
    companionCustomerFutureBoundary: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn()
    },
    recommendationRequest: { updateMany: jest.fn() },
    notification: { deleteMany: jest.fn() },
    supportTicket: { count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn()
  } as any;

  const moderation = {
    moderate: jest.fn(),
    moderateAsync: jest.fn()
  } as any;

  const moderationCases = {
    createFromResult: jest.fn()
  } as any;
  const chatRestrictions = { assertCanSend: jest.fn(), activeForUser: jest.fn() } as any;
  const mediaAssets = {
    isFeatureEnabled: jest.fn(() => false),
    assertChatMediaUploadEnabled: jest.fn(),
    attachmentsForMessage: jest.fn().mockResolvedValue([]),
    reserve: jest.fn(),
    complete: jest.fn()
  } as any;
  const mediaWorker = { enqueue: jest.fn() } as any;
  const notifications = { createConversationMessageReceivedIfUnmuted: jest.fn() } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const crisisIntervention = { recordCriticalChatSignal: jest.fn().mockResolvedValue(null) } as any;

  let service: ConversationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ available: false }]);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.companionCustomerFutureBoundary.findUnique.mockResolvedValue(null);
    prisma.recommendationRequest.updateMany.mockResolvedValue({ count: 0 });
    service = new ConversationsService(
      prisma,
      moderation,
      moderationCases,
      chatRestrictions,
      mediaAssets,
      mediaWorker,
      notifications,
      audit,
      crisisIntervention
    );
  });

  it("returns an activated conversation for an authorized participant", async () => {
    const existing = {
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companionId: "c1",
      companion: { id: "c1", name: "林屿", isPublished: false }
    };
    prisma.conversation.findFirst.mockResolvedValue(existing);

    const result = await (service as any).ensureConversation("u1", "c1");

    expect(result).toBe(existing);
    expect(prisma.companionProfile.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: {
        orders: { some: { status: { in: ["paid", "inService", "completed"] } } },
        OR: [
          { userId: "u1", externalId: "c1" },
          { id: "c1", companion: { ownerUserId: "u1" } }
        ]
      },
      include: {
        companion: true,
        user: { include: { profile: true } }
      }
    });
  });

  it("keeps the companion's future-booking choice private while invalidating future recommendation cursors", async () => {
    const existing = {
      id: "conv-1",
      externalId: "c1",
      userId: "customer-1",
      companionId: "c1",
      companion: { id: "c1", ownerUserId: "companion-owner", name: "林屿" },
      user: { id: "customer-1", profile: { nickname: "顾客" } }
    };
    prisma.conversation.findFirst.mockResolvedValue(existing);
    prisma.companionCustomerFutureBoundary.create.mockResolvedValue({ id: "boundary-1" });

    const declined = await service.setFutureBookingBoundary(
      "companion-owner",
      "conv-1",
      { declined: true }
    );

    expect(declined).toEqual({
      viewerCanManageFutureBookingBoundary: true,
      futureBookingsDeclinedByYou: true,
      futureBookingBoundaryScope: "newOrdersAndRecommendationsOnly",
      existingOrdersUnaffected: true,
      conversationUnaffected: true,
      changed: true
    });
    expect(prisma.companionCustomerFutureBoundary.create).toHaveBeenCalledWith({
      data: { companionId: "c1", customerUserId: "customer-1" }
    });
    expect(prisma.recommendationRequest.updateMany).toHaveBeenCalledWith({
      where: { userId: "customer-1", expiresAt: { gt: expect.any(Date) } },
      data: { expiresAt: expect.any(Date) }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "companion-owner",
      subjectUserIds: ["companion-owner", "customer-1"],
      action: "conversation.future_booking_declined",
      resourceType: "conversation",
      resourceId: "conv-1",
      metadata: {
        scope: "new_orders_and_recommendations_only",
        existingOrdersUnaffected: true,
        conversationUnaffected: true
      }
    }), prisma);

    prisma.companionCustomerFutureBoundary.findUnique.mockResolvedValue({ id: "boundary-1" });
    const companionStatus = await service.conversationStatus("companion-owner", "conv-1");
    expect(companionStatus).toEqual(expect.objectContaining({
      viewerCanManageFutureBookingBoundary: true,
      futureBookingsDeclinedByYou: true,
      existingOrdersUnaffected: true,
      conversationUnaffected: true
    }));

    prisma.companionCustomerFutureBoundary.findUnique.mockClear();
    const customerStatus = await service.conversationStatus("customer-1", "c1");
    expect(customerStatus).toEqual(expect.objectContaining({
      viewerCanManageFutureBookingBoundary: false,
      futureBookingsDeclinedByYou: false,
      existingOrdersUnaffected: true,
      conversationUnaffected: true
    }));
    expect(prisma.companionCustomerFutureBoundary.findUnique).not.toHaveBeenCalled();

    await expect(service.setFutureBookingBoundary("customer-1", "c1", { declined: true }))
      .rejects.toMatchObject({ code: "FUTURE_BOOKING_BOUNDARY_COMPANION_ONLY" });

    prisma.companionCustomerFutureBoundary.findUnique.mockResolvedValue({ id: "boundary-1" });
    const restored = await service.setFutureBookingBoundary(
      "companion-owner",
      "conv-1",
      { declined: false }
    );
    expect(restored).toEqual(expect.objectContaining({
      futureBookingsDeclinedByYou: false,
      changed: true
    }));
    expect(prisma.companionCustomerFutureBoundary.delete).toHaveBeenCalledWith({
      where: { id: "boundary-1" }
    });
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "conversation.future_booking_restored"
    }), prisma);
  });

  it("rejects free messaging to a published companion", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.companionProfile.findFirst.mockResolvedValue({ id: "c1", isPublished: true });

    await expect((service as any).ensureConversation("u1", "c1")).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED"
    });

    expect(prisma.companionProfile.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", isPublished: true }
    });
  });

  it("hides unknown or unauthorized conversation routes", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect((service as any).ensureConversation("third-party", "conv-private")).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND"
    });
  });

  it("filters message pages so a recipient cannot use a hidden message as a cursor", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companion: { ownerUserId: "companion-owner" }
    });
    prisma.message.findFirst.mockResolvedValue(null);

    await expect(service.messages("companion-owner", "conv-1", { cursor: "hidden-message" })).rejects.toMatchObject({
      code: "INVALID_CURSOR"
    });
    expect(prisma.message.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "hidden-message",
        conversationId: "conv-1",
        AND: [expect.objectContaining({ OR: expect.any(Array) })]
      })
    }));
  });

  it("queries only published participant messages plus the viewer's own held messages", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companion: { ownerUserId: "companion-owner" }
    });
    prisma.message.findMany.mockResolvedValue([]);

    await service.messages("companion-owner", "conv-1", {});

    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        conversationId: "conv-1",
        AND: [
          {
            OR: [
              { moderationStatus: "published", visibility: "participants" },
              { senderId: "companion-owner" }
            ]
          }
        ]
      })
    }));
  });

  it("returns the documented cursor envelope with a public conversation id", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companion: { ownerUserId: "companion-owner" }
    });
    const createdAt = new Date("2026-08-09T10:00:00.000Z");
    prisma.message.findMany.mockResolvedValue([
      {
        id: "message-3",
        senderId: "companion-owner",
        senderName: "林屿",
        content: "最新一条",
        type: "text",
        moderationStatus: "published",
        visibility: "participants",
        createdAt: new Date(createdAt.getTime() + 2_000)
      },
      {
        id: "message-2",
        senderId: "u1",
        senderName: "顾客",
        content: "中间一条",
        type: "text",
        moderationStatus: "published",
        visibility: "participants",
        createdAt: new Date(createdAt.getTime() + 1_000)
      },
      {
        id: "message-1",
        senderId: "companion-owner",
        senderName: "林屿",
        content: "更早一条",
        type: "text",
        moderationStatus: "published",
        visibility: "participants",
        createdAt
      }
    ]);

    await expect(service.messages("u1", "c1", { limit: 2 })).resolves.toEqual({
      messages: [
        expect.objectContaining({ id: "message-2", conversationId: "c1", attachments: [] }),
        expect.objectContaining({ id: "message-3", conversationId: "c1", attachments: [] })
      ],
      pagination: { limit: 2, nextCursor: "message-2", hasMore: true }
    });
  });

  it("keeps completed-order history readable while closing every new-message path", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companion: { ownerUserId: "companion-owner" },
      user: { profile: null }
    });
    prisma.order.findMany.mockResolvedValue([{
      status: "completed",
      scheduledAt: new Date("2026-07-20T08:00:00.000Z"),
      serviceStartedAt: new Date("2026-07-20T08:00:00.000Z"),
      durationMinutes: 30
    }]);
    prisma.message.findMany.mockResolvedValue([]);
    chatRestrictions.activeForUser.mockResolvedValue(null);

    await expect(service.conversationStatus("u1", "c1")).resolves.toEqual(expect.objectContaining({
      messageHistoryAvailable: true,
      messageInteractionAvailable: false
    }));
    await expect(service.messages("u1", "c1", {})).resolves.toEqual(expect.objectContaining({ messages: [] }));
    await expect((service as any).assertConversationInteractionAvailable("conv-1")).rejects.toMatchObject({
      code: "CONVERSATION_INTERACTION_UNAVAILABLE"
    });
    expect(prisma.message.findMany).toHaveBeenCalled();
  });

  it("rejects media reservation and completion after the paid communication window closes", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companion: { ownerUserId: "companion-owner" }
    });
    prisma.order.findMany.mockResolvedValue([{
      status: "paid",
      scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      serviceStartedAt: null,
      durationMinutes: 30
    }]);
    chatRestrictions.assertCanSend.mockResolvedValue(undefined);

    await expect(service.reserveMediaUpload("u1", "c1", {
      kind: "image",
      mimeType: "image/jpeg",
      sizeBytes: 128,
      sha256: "a".repeat(64)
    })).rejects.toMatchObject({ code: "CONVERSATION_INTERACTION_UNAVAILABLE" });
    await expect(service.completeMediaUpload("u1", "c1", "asset-1"))
      .rejects.toMatchObject({ code: "CONVERSATION_INTERACTION_UNAVAILABLE" });

    expect(mediaAssets.reserve).not.toHaveBeenCalled();
    expect(mediaAssets.complete).not.toHaveBeenCalled();
  });

  it("returns and changes only the current participant's persisted mute preference", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companion: { ownerUserId: "companion-owner" },
      user: { profile: null }
    });
    prisma.conversationNotificationPreference.findUnique.mockResolvedValue({ mutedAt: new Date("2026-07-20T00:00:00.000Z") });
    chatRestrictions.activeForUser.mockResolvedValue(null);

    await expect(service.conversationStatus("u1", "c1")).resolves.toEqual(expect.objectContaining({
      messageNotificationsMuted: true
    }));
    expect(prisma.conversationNotificationPreference.findUnique).toHaveBeenCalledWith({
      where: { conversationId_userId: { conversationId: "conv-1", userId: "u1" } },
      select: { mutedAt: true }
    });

    await service.setMessageNotificationsMuted("u1", "c1", { muted: true });
    expect(prisma.conversationNotificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId_userId: { conversationId: "conv-1", userId: "u1" } },
      create: expect.objectContaining({ conversationId: "conv-1", userId: "u1", mutedAt: expect.any(Date) })
    }));

    await service.setMessageNotificationsMuted("u1", "c1", { muted: false });
    expect(prisma.conversationNotificationPreference.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", userId: "u1" }
    });
  });

  it("creates an active-only block under the conversation lock without touching orders or non-message notices", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companion: { ownerUserId: "companion-owner" },
      user: { profile: null }
    });
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      conversationBlock: {
        upsert: jest.fn().mockResolvedValue({ id: "block-1" }),
        deleteMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: "block-1" })
      },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) }
    };
    prisma.$transaction.mockImplementation(async (callback: (database: any) => Promise<unknown>) => callback(db));

    await expect(service.setConversationBlocked("u1", "c1", { blocked: true })).resolves.toEqual({
      conversationBlockedByYou: true,
      messageHistoryAvailable: false,
      messageInteractionAvailable: false
    });

    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.conversationBlock.upsert).toHaveBeenCalledWith({
      where: { conversationId_blockedByUserId: { conversationId: "conv-1", blockedByUserId: "u1" } },
      create: { conversationId: "conv-1", blockedByUserId: "u1" },
      update: {}
    });
    expect(db.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        type: "messageReceived",
        eventKey: { startsWith: "conversation:conv-1:" }
      }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "conversation.blocked",
      resourceId: "conv-1",
      metadata: { scope: "message_interaction_only" }
    }), db);
  });

  it("hides message history for both sides after a block without deleting it or allowing a cursor probe", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companion: { ownerUserId: "companion-owner" }
    });
    prisma.conversationBlock.findFirst.mockResolvedValue({ id: "block-1" });

    await expect(service.messages("u1", "c1", { cursor: "old-message" })).resolves.toEqual({
      messages: [],
      pagination: { limit: 50, nextCursor: null, hasMore: false }
    });
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("includes only the viewer's mute flag in their conversation list", async () => {
    prisma.conversation.findMany.mockResolvedValue([{
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companionId: "c1",
      companion: { id: "c1", name: "林屿", role: "倾听者", initials: "林屿", isOnline: false, isVerified: true, availability: "available", responseTime: "" },
      user: { profile: null },
      messages: [],
      readStates: [],
      notificationPreferences: [{ mutedAt: new Date("2026-07-20T00:00:00.000Z") }],
      blocks: [],
      updatedAt: new Date("2026-07-20T00:00:00.000Z")
    }]);
    prisma.conversation.count.mockResolvedValue(1);
    prisma.message.groupBy.mockResolvedValue([{ conversationId: "conv-1", _count: { _all: 3 } }]);

    const result = await service.list("u1", { page: 2, pageSize: 10 });

    expect(result.conversations[0]).toEqual(expect.objectContaining({
      messageNotificationsMuted: true,
      unreadCount: 3
    }));
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 1, totalPages: 1 });
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        notificationPreferences: { where: { userId: "u1" }, select: { mutedAt: true }, take: 1 },
        blocks: { select: { blockedByUserId: true }, take: 2 }
      }),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: 10,
      take: 10
    }));
    expect(prisma.conversation.findMany.mock.calls[0][0].include).not.toHaveProperty("orders");
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.message.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.message.count).not.toHaveBeenCalled();
  });

  it("returns an authoritative aggregate for active customer support work", async () => {
    prisma.supportTicket.count.mockResolvedValue(4);

    await expect(service.summary("u1")).resolves.toEqual({ activeSupportCount: 4 });
    expect(prisma.supportTicket.count).toHaveBeenCalledWith({
      where: { userId: "u1", status: { in: ["open", "inProgress"] } }
    });
  });
});

describe("ConversationsService.send identity hard gate", () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      update: jest.fn()
    },
    conversationBlock: {
      findFirst: jest.fn()
    },
    user: { findUnique: jest.fn() },
    message: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    moderationCase: { count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn()
  } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const moderationCases = { createFromResult: jest.fn() } as any;
  const chatRestrictions = { assertCanSend: jest.fn(), activeForUser: jest.fn() } as any;
  const mediaAssets = {
    isFeatureEnabled: jest.fn(() => false),
    assertChatMediaUploadEnabled: jest.fn(),
    attachmentsForMessage: jest.fn().mockResolvedValue([]),
    bindUploadedAssets: jest.fn()
  } as any;
  const mediaWorker = { enqueue: jest.fn() } as any;
  const notifications = { createConversationMessageReceivedIfUnmuted: jest.fn() } as any;
  const audit = { record: jest.fn() } as any;
  const crisisIntervention = { recordCriticalChatSignal: jest.fn().mockResolvedValue(null) } as any;
  let service: ConversationsService;

  const conversation = {
    id: "conv-1",
    externalId: "c1",
    userId: "u1",
    companionId: "comp-1",
    companion: { ownerUserId: "companion-owner", name: "林屿" }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mediaAssets.assertChatMediaUploadEnabled.mockImplementation(() => undefined);
    prisma.$queryRaw.mockResolvedValue([{ available: true }]);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.conversation.findFirst.mockResolvedValue(conversation);
    prisma.conversationBlock.findFirst.mockResolvedValue(null);
    prisma.message.findMany.mockResolvedValue([]);
    prisma.moderationCase.count.mockResolvedValue(0);
    service = new ConversationsService(
      prisma,
      moderation,
      moderationCases,
      chatRestrictions,
      mediaAssets,
      mediaWorker,
      notifications,
      audit,
      crisisIntervention
    );
  });

  it("rejects an unverified sender before moderation, message, case, or notification writes", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      accountStatus: "active",
      profile: { displayName: "小安", isVerified: false, safetyScore: 80 }
    });

    await expect(service.send("u1", "c1", { content: "你好" })).rejects.toMatchObject({
      code: "PUBLIC_INTERACTION_IDENTITY_REQUIRED",
      status: 403
    });

    expect(chatRestrictions.assertCanSend).toHaveBeenCalledWith("u1");
    expect(moderation.moderateAsync).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(moderationCases.createFromResult).not.toHaveBeenCalled();
    expect(notifications.createConversationMessageReceivedIfUnmuted).not.toHaveBeenCalled();
    expect(crisisIntervention.recordCriticalChatSignal).not.toHaveBeenCalled();
  });

  it("rejects attachment input before any chat, identity, moderation, or message work on text-only", async () => {
    mediaAssets.assertChatMediaUploadEnabled.mockImplementation(() => {
      throw Object.assign(new Error("media disabled"), { code: "MEDIA_FEATURE_DISABLED", status: 503 });
    });

    await expect(service.send("u1", "c1", { attachmentIds: ["asset-1"] })).rejects.toMatchObject({
      code: "MEDIA_FEATURE_DISABLED",
      status: 503
    });

    expect(chatRestrictions.assertCanSend).not.toHaveBeenCalled();
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(moderation.moderateAsync).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(moderationCases.createFromResult).not.toHaveBeenCalled();
    expect(notifications.createConversationMessageReceivedIfUnmuted).not.toHaveBeenCalled();
  });

  it("rejects a legacy verified sender before moderation because the boolean has no authority binding", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      accountStatus: "active",
      profile: { displayName: "小安", isVerified: true, safetyScore: 80 }
    });
    moderation.moderateAsync.mockResolvedValue({
      decision: "allow",
      riskLevel: "low",
      priority: "normal",
      score: 0.01,
      reasons: [],
      matchedRules: [],
      categories: ["normal"],
      policyVersion: "chat-v2",
      usedAI: false
    });
    const createdMessage = {
      id: "m1",
      conversationId: "conv-1",
      senderId: "u1",
      senderName: "小安",
      content: "你好",
      type: "text",
      moderationStatus: "published",
      visibility: "participants",
      moderationDecision: "allow",
      policyVersion: "chat-v2",
      reviewedAt: new Date(),
      createdAt: new Date()
    };
    prisma.message.create.mockResolvedValue(createdMessage);
    prisma.conversation.update.mockResolvedValue(conversation);
    mediaAssets.attachmentsForMessage.mockResolvedValue([]);

    await expect(service.send("u1", "c1", { content: "你好" })).rejects.toMatchObject({
      code: "PUBLIC_INTERACTION_IDENTITY_REQUIRED",
      status: 403,
      details: expect.objectContaining({
        verificationStatus: "notVerified",
        publicInteractionBlocked: true
      })
    });

    expect(moderation.moderateAsync).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(notifications.createConversationMessageReceivedIfUnmuted).not.toHaveBeenCalled();
  });
});
