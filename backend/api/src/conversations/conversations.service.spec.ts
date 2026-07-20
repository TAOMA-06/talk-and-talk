import { ConversationsService } from "./conversations.service";

describe("ConversationsService.ensureConversation", () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn()
    },
    companionProfile: {
      findFirst: jest.fn()
    },
    message: {
      findFirst: jest.fn(),
      findMany: jest.fn()
    },
    $executeRaw: jest.fn()
  } as any;

  const moderation = {
    moderate: jest.fn(),
    moderateAsync: jest.fn()
  } as any;

  const moderationCases = {
    createFromResult: jest.fn()
  } as any;
  const chatRestrictions = { assertCanSend: jest.fn() } as any;
  const mediaAssets = { isFeatureEnabled: jest.fn(() => false) } as any;
  const mediaWorker = { enqueue: jest.fn() } as any;

  let service: ConversationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationsService(
      prisma,
      moderation,
      moderationCases,
      chatRestrictions,
      mediaAssets,
      mediaWorker
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
});
