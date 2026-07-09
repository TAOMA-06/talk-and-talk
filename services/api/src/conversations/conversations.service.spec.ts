import { ConversationsService } from "./conversations.service";

describe("ConversationsService.ensureConversation", () => {
  const prisma = {
    conversation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn()
    },
    companionProfile: {
      findFirst: jest.fn()
    }
  } as any;

  const moderation = {
    moderate: jest.fn()
  } as any;

  let service: ConversationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationsService(prisma, moderation);
  });

  it("returns an existing conversation even when the companion is unpublished", async () => {
    const existing = {
      id: "conv-1",
      externalId: "c1",
      userId: "u1",
      companionId: "c1",
      companion: { id: "c1", name: "林屿", isPublished: false }
    };
    prisma.conversation.findUnique.mockResolvedValue(existing);

    const result = await (service as any).ensureConversation("u1", "c1");

    expect(result).toBe(existing);
    expect(prisma.companionProfile.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it("requires a published companion when creating a new conversation", async () => {
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect((service as any).ensureConversation("u1", "c-missing")).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND"
    });

    expect(prisma.companionProfile.findFirst).toHaveBeenCalledWith({
      where: { id: "c-missing", isPublished: true }
    });
  });

  it("creates a conversation for a published companion when none exists", async () => {
    const companion = { id: "c1", name: "林屿", isPublished: true };
    const created = {
      id: "conv-2",
      externalId: "c1",
      userId: "u1",
      companionId: "c1",
      companion
    };
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.companionProfile.findFirst.mockResolvedValue(companion);
    prisma.conversation.create.mockResolvedValue(created);

    const result = await (service as any).ensureConversation("u1", "c1");

    expect(result).toBe(created);
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: {
        externalId: "c1",
        userId: "u1",
        companionId: "c1"
      },
      include: { companion: true }
    });
  });
});
