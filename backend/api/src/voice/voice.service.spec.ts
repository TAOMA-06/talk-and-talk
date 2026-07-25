const mockGenUserSig = jest.fn();
const mockGenPrivateMapKey = jest.fn();
const mockSignerConstructor = jest.fn(() => ({
  genUserSig: mockGenUserSig,
  genPrivateMapKeyWithStringRoomID: mockGenPrivateMapKey
}));

jest.mock("tls-sig-api-v2", () => ({ Api: mockSignerConstructor }), { virtual: true });

import { VoiceService } from "./voice.service";

describe("VoiceService", () => {
  const voiceConfig: Record<string, unknown> = {
    TRTC_ENABLED: true,
    TRTC_SDK_APP_ID: 1400000001,
    TRTC_SDK_SECRET_KEY: "trtc-test-secret-key-material",
    TRTC_PRIVATE_MAP_KEY_ENABLED: true,
    TRTC_USER_SIG_TTL_SECONDS: 300
  };

  let configValues: Record<string, unknown>;
  let prisma: any;
  let audit: any;
  let service: VoiceService;

  const activeVoiceOrder = (overrides: Record<string, unknown> = {}) => ({
    id: "11111111-2222-4333-8444-555555555555",
    userId: "customer-user-123",
    status: "inService",
    serviceOfferingDeliveryModeSnapshot: "voice",
    companionConfirmedAt: new Date(Date.now() - 5 * 60_000),
    serviceStartedAt: new Date(Date.now() - 2 * 60_000),
    scheduledAt: new Date(Date.now() - 5 * 60_000),
    durationMinutes: 30,
    companion: { ownerUserId: "companion-user-456", name: "小安", initials: "小安" },
    ...overrides
  });

  beforeEach(() => {
    configValues = { ...voiceConfig };
    prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findFirst: jest.fn().mockResolvedValue(activeVoiceOrder()) },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      voiceSession: { upsert: jest.fn().mockResolvedValue({ roomId: "tt_voice_11111111222243338444555555555555" }) }
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new VoiceService(
      prisma,
      { get: jest.fn((key: string, fallback?: unknown) => configValues[key] ?? fallback) } as any,
      audit
    );
    mockSignerConstructor.mockClear();
    mockGenUserSig.mockReset().mockReturnValue("short-lived-user-sig");
    mockGenPrivateMapKey.mockReset().mockReturnValue("restricted-private-map-key");
  });

  it("issues opaque, short-lived credentials only to an in-service voice-order participant", async () => {
    const access = await service.issueRoomAccess("customer-user-123", "11111111-2222-4333-8444-555555555555");

    expect(access).toEqual(expect.objectContaining({
      provider: "trtc",
      sdkAppId: 1400000001,
      roomId: "tt_voice_11111111222243338444555555555555",
      userSig: "short-lived-user-sig",
      privateMapKey: "restricted-private-map-key",
      participantRole: "customer"
    }));
    expect(access.userId).not.toBe("customer-user-123");
    expect(access.userId).toMatch(/^tt_[A-Za-z0-9_-]{24}$/);
    expect(mockSignerConstructor).toHaveBeenCalledWith(1400000001, "trtc-test-secret-key-material");
    expect(mockGenUserSig).toHaveBeenCalledWith(access.userId, expect.any(Number));
    expect(mockGenPrivateMapKey).toHaveBeenCalledWith(access.userId, expect.any(Number), access.roomId, 15);
    expect(prisma.voiceSession.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: "11111111-2222-4333-8444-555555555555" },
      create: expect.objectContaining({ accessCount: 1, provider: "trtc" }),
      update: expect.objectContaining({ accessCount: { increment: 1 } })
    }));
    const auditInput = audit.record.mock.calls[0][0];
    expect(auditInput).toEqual(expect.objectContaining({ action: "voice.room_access_granted" }));
    expect(auditInput.metadata).not.toHaveProperty("userSig");
    expect(auditInput.metadata).not.toHaveProperty("privateMapKey");
    expect(JSON.stringify(auditInput.metadata)).not.toContain("trtc-test-secret-key-material");
  });

  it("honors the full paid duration after a delayed manual service start", async () => {
    const scheduledAt = new Date(Date.now() - 5 * 60_000);
    const serviceStartedAt = new Date(Date.now() - 2 * 60_000);
    prisma.order.findFirst.mockResolvedValue(activeVoiceOrder({ scheduledAt, serviceStartedAt }));

    const access = await service.issueRoomAccess("customer-user-123", "11111111-2222-4333-8444-555555555555");

    expect(access.serviceEndsAt).toBe(
      new Date(serviceStartedAt.getTime() + 30 * 60_000).toISOString()
    );
  });

  it("serializes authorization with the same order lock used by refund handling", async () => {
    await service.issueRoomAccess("customer-user-123", "11111111-2222-4333-8444-555555555555");

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 10_000
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const query = Array.from(prisma.$queryRaw.mock.calls[0][0] as string[]).join("");
    expect(query).toContain('SELECT "id" FROM "Order"');
    expect(query).toContain("FOR UPDATE");
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("does not query orders or load a signer while real-time voice is disabled", async () => {
    configValues.TRTC_ENABLED = false;

    await expect(service.issueRoomAccess("customer-user-123", "order-1"))
      .rejects.toMatchObject({ code: "VOICE_FEATURE_DISABLED" });
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
    expect(mockSignerConstructor).not.toHaveBeenCalled();
  });

  it("refuses new credentials while an emergency room drain is active", async () => {
    configValues.TRTC_EMERGENCY_STOP_ENABLED = true;

    await expect(service.issueRoomAccess("customer-user-123", "order-1"))
      .rejects.toMatchObject({ code: "VOICE_FEATURE_EMERGENCY_STOP" });
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
    expect(prisma.voiceSession.upsert).not.toHaveBeenCalled();
    expect(mockSignerConstructor).not.toHaveBeenCalled();
  });

  it("does not reveal an order to a non-participant", async () => {
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(service.issueRoomAccess("unrelated-user", "order-1"))
      .rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    expect(prisma.voiceSession.upsert).not.toHaveBeenCalled();
    expect(mockSignerConstructor).not.toHaveBeenCalled();
  });

  it.each([
    ["the SKU is not voice", { serviceOfferingDeliveryModeSnapshot: "text" }, "VOICE_ORDER_NOT_ELIGIBLE"],
    ["the companion has not accepted", { companionConfirmedAt: null }, "VOICE_ORDER_NOT_ACCEPTED"],
    ["the companion has not started", { status: "paid", serviceStartedAt: null }, "VOICE_SERVICE_NOT_STARTED"],
    ["the scheduled service window has elapsed", {
      scheduledAt: new Date(Date.now() - 31 * 60_000),
      serviceStartedAt: new Date(Date.now() - 31 * 60_000),
      durationMinutes: 30
    }, "VOICE_SERVICE_WINDOW_EXPIRED"]
  ])("refuses access when %s", async (_label, overrides, code) => {
    prisma.order.findFirst.mockResolvedValue(activeVoiceOrder(overrides));

    await expect(service.issueRoomAccess("customer-user-123", "order-1"))
      .rejects.toMatchObject({ code });
    expect(prisma.voiceSession.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(mockSignerConstructor).not.toHaveBeenCalled();
  });

  it("revokes new room access while after-sales handling is active", async () => {
    prisma.refundTransaction.findFirst.mockResolvedValue({ id: "refund-1" });

    await expect(service.issueRoomAccess("customer-user-123", "order-1"))
      .rejects.toMatchObject({ code: "VOICE_REFUND_IN_PROGRESS" });
    expect(prisma.voiceSession.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(mockSignerConstructor).not.toHaveBeenCalled();
  });

  it("converts provider signing failures into a non-sensitive availability error", async () => {
    mockGenUserSig.mockImplementation(() => { throw new Error("provider said secret=do-not-leak"); });

    await expect(service.issueRoomAccess("customer-user-123", "order-1"))
      .rejects.toMatchObject({ code: "VOICE_SIGNING_UNAVAILABLE" });
    expect(prisma.voiceSession.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
