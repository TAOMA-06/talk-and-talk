import { ConversationsService } from "./conversations.service";

describe("ConversationsService.ensureConversation", () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      findMany: jest.fn()
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
      count: jest.fn()
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
    notification: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
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
    attachmentsForMessage: jest.fn().mockResolvedValue([]),
    reserve: jest.fn(),
    complete: jest.fn()
  } as any;
  const mediaWorker = { enqueue: jest.fn() } as any;
  const notifications = { createConversationMessageReceivedIfUnmuted: jest.fn() } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;

  let service: ConversationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationsService(
      prisma,
      moderation,
      moderationCases,
      chatRestrictions,
      mediaAssets,
      mediaWorker,
      notifications,
      audit
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
      orders: [],
      updatedAt: new Date("2026-07-20T00:00:00.000Z")
    }]);
    prisma.message.count.mockResolvedValue(0);

    const result = await service.list("u1");

    expect(result.conversations[0]).toEqual(expect.objectContaining({ messageNotificationsMuted: true }));
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        notificationPreferences: { where: { userId: "u1" }, select: { mutedAt: true }, take: 1 },
        blocks: { select: { blockedByUserId: true }, take: 2 },
        orders: expect.objectContaining({
          where: { status: { in: ["paid", "inService"] } }
        })
      })
    }));
  });
});
