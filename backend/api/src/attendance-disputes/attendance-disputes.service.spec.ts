import { createHash, createHmac } from "node:crypto";

import { AttendanceDisputesService } from "./attendance-disputes.service";

const customerId = "11111111-1111-4111-8111-111111111111";
const companionId = "22222222-2222-4222-8222-222222222222";
const callbackKey = "CallbackKey1234567890";

function trtcUserId(userId: string): string {
  return `tt_${createHash("sha256")
    .update(`talk-and-talk:trtc-user:${userId}`)
    .digest("base64url")
    .slice(0, 24)}`;
}

function callbackBody(overrides: Record<string, unknown> = {}): Buffer {
  const now = Date.now();
  return Buffer.from(JSON.stringify({
    EventGroupId: 1,
    EventType: 103,
    CallbackTs: now,
    EventInfo: {
      RoomId: "tt_voice_order1",
      EventMsTs: now - 50,
      UserId: trtcUserId(customerId),
      UniqueId: 10,
      Role: 20,
      TerminalType: 2,
      ClientIpv4: "198.51.100.10",
      ...overrides
    }
  }));
}

function createHarness(configValues: Record<string, unknown> = {}) {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    order: { findUnique: jest.fn() },
    voiceAttendanceEvent: {
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn()
    },
    attendanceDispute: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    attendanceDisputeStatement: { count: jest.fn(), create: jest.fn() }
  };
  const prisma: any = {
    $transaction: jest.fn((callback: (value: any) => unknown) => callback(tx)),
    order: { findFirst: jest.fn() },
    voiceSession: { findUnique: jest.fn() },
    voiceAttendanceEvent: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([])
    },
    attendanceDispute: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn()
    }
  };
  const config: any = {
    get: jest.fn((key: string, fallback?: unknown) => ({
      COMMERCIAL_SURFACE: "full",
      TRTC_ENABLED: true,
      TRTC_SDK_APP_ID: 1400000001,
      TRTC_CALLBACK_SIGNING_KEY: callbackKey,
      ...configValues
    })[key] ?? fallback)
  };
  const audit: any = { record: jest.fn().mockResolvedValue(undefined) };
  const commercial: any = {
    holdForOrder: jest.fn().mockResolvedValue(1),
    reconcileOrderEarning: jest.fn().mockResolvedValue(null)
  };
  const payments: any = { requestAttendanceDisputeRefund: jest.fn() };
  const notifications: any = { createTransactional: jest.fn().mockResolvedValue({ id: "notification-1" }) };
  const caseEvidence: any = {
    attachmentInclude: jest.fn().mockReturnValue({ evidenceAttachments: { include: { mediaAsset: true } } }),
    attachmentDtos: jest.fn().mockReturnValue([]),
    assertAttachmentsAllowed: jest.fn(),
    bindAttendanceStatement: jest.fn().mockResolvedValue([])
  };
  return {
    service: new AttendanceDisputesService(prisma, config, audit, commercial, payments, notifications, caseEvidence),
    prisma,
    tx,
    audit,
    commercial,
    payments,
    notifications,
    caseEvidence
  };
}

describe("AttendanceDisputesService", () => {
  it("does not expose a provider refund identifier in a participant attendance case", async () => {
    const { service, prisma } = createHarness();
    const now = new Date("2026-08-10T00:00:00.000Z");
    prisma.attendanceDispute.findUnique.mockResolvedValue({
      id: "case-participant-refund",
      orderId: "order-1",
      openedByUserId: customerId,
      openedByRole: "customer",
      counterpartyUserId: companionId,
      issue: "companionAbsent",
      status: "final",
      policyVersionSnapshot: "fulfillment-test-v1",
      timezoneSnapshot: "Asia/Shanghai",
      evidenceDueAt: now,
      counterpartyResponseDueAt: now,
      appealDeadlineAt: null,
      appealResponseDueAt: null,
      decision: "fullRefund",
      decisionReason: "已确认退款。",
      decidedAt: now,
      appealedAt: null,
      appealedByUserId: null,
      finalDecision: "fullRefund",
      finalReason: "已确认退款。",
      finalizedAt: now,
      assignedToUserId: "staff-1",
      decidedByUserId: "staff-1",
      appealAssignedToUserId: null,
      appealReviewedByUserId: null,
      refundTransaction: {
        id: "refund-private",
        status: "success",
        amountCents: 9900,
        providerRefundId: "wx-provider-private",
        updatedAt: now
      },
      statements: [],
      createdAt: now,
      updatedAt: now,
      order: {
        id: "order-1",
        status: "refunded",
        scheduledAt: now,
        durationMinutes: 30,
        serviceOfferingTitleSnapshot: "文字陪伴",
        voiceSession: null,
        companion: { ownerUserId: companionId }
      }
    });

    const result: any = await service.getForParticipant(customerId, "case-participant-refund");
    const staffResult: any = await service.getForStaff(
      { id: "staff-1", role: "admin" } as any,
      "case-participant-refund"
    );

    expect(result.refund).toEqual({
      id: "refund-private",
      status: "success",
      amountCents: 9900,
      successConfirmedAt: now.toISOString()
    });
    expect(result.refund).not.toHaveProperty("providerRefundId");
    expect(result).not.toHaveProperty("staff");
    expect(staffResult.refund).toEqual(result.refund);
    expect(staffResult.refund).not.toHaveProperty("providerRefundId");
    expect(staffResult.staff).toEqual({
      assignedToUserId: "staff-1",
      decidedByUserId: "staff-1",
      appealAssignedToUserId: null,
      appealReviewedByUserId: null
    });
  });

  it("returns 404 for a support identity outside both canonical assignment scopes", async () => {
    const { service, prisma } = createHarness();
    prisma.attendanceDispute.findUnique.mockResolvedValue({
      id: "case-private",
      assignedToUserId: "support-initial",
      appealAssignedToUserId: "support-appeal"
    });

    await expect(service.getForStaff(
      { id: "support-other", role: "support" } as any,
      "case-private"
    )).rejects.toMatchObject({ code: "ATTENDANCE_CASE_NOT_FOUND", status: 404 });
    expect(prisma.voiceAttendanceEvent.groupBy).not.toHaveBeenCalled();
  });

  it("accepts an official HMAC-signed allowlisted callback without retaining IP or terminal fingerprints", async () => {
    const { service, prisma } = createHarness();
    prisma.voiceSession.findUnique.mockResolvedValue({
      id: "voice-1",
      order: { userId: customerId, companion: { ownerUserId: companionId } }
    });
    prisma.voiceAttendanceEvent.create.mockResolvedValue({ id: "event-1" });
    const rawBody = callbackBody();
    const sign = createHmac("sha256", callbackKey).update(rawBody).digest("base64");

    await expect(service.ingestTrtcCallback(rawBody, sign, "1400000001"))
      .resolves.toEqual({ code: 0, accepted: true, duplicate: false });
    const data = prisma.voiceAttendanceEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      voiceSessionId: "voice-1",
      participantUserId: customerId,
      participantRole: "customer",
      type: "join",
      source: "provider"
    });
    expect(JSON.stringify(data)).not.toMatch(/198\.51\.100\.10|ClientIpv|TerminalType|device/i);
  });

  it("maps Tencent network retry entries to reconnect and deduplicates by provider event identity", async () => {
    const { service, prisma } = createHarness();
    prisma.voiceSession.findUnique.mockResolvedValue({
      id: "voice-1",
      order: { userId: customerId, companion: { ownerUserId: companionId } }
    });
    prisma.voiceAttendanceEvent.create.mockRejectedValue({ code: "P2002" });
    const rawBody = callbackBody({ Reason: 2 });
    const sign = createHmac("sha256", callbackKey).update(rawBody).digest("base64");

    await expect(service.ingestTrtcCallback(rawBody, sign, "1400000001"))
      .resolves.toEqual({ code: 0, accepted: true, duplicate: true });
    expect(prisma.voiceAttendanceEvent.create.mock.calls[0][0].data.type).toBe("reconnect");
  });

  it("fails closed when TRTC callback verification is disabled or the signature is invalid", async () => {
    const disabled = createHarness({ TRTC_ENABLED: false }).service;
    const rawBody = callbackBody();
    await expect(disabled.ingestTrtcCallback(rawBody, "bad", "1400000001"))
      .rejects.toMatchObject({ code: "TRTC_CALLBACK_DISABLED" });

    const enabled = createHarness().service;
    await expect(enabled.ingestTrtcCallback(rawBody, "bad", "1400000001"))
      .rejects.toMatchObject({ code: "TRTC_CALLBACK_SIGNATURE_INVALID" });
  });

  it("blocks TRTC callbacks and client attendance writes for a text-only commercial surface", async () => {
    const { service, prisma } = createHarness({ COMMERCIAL_SURFACE: "text_only" });
    const rawBody = callbackBody();
    const sign = createHmac("sha256", callbackKey).update(rawBody).digest("base64");

    await expect(service.ingestTrtcCallback(rawBody, sign, "1400000001"))
      .rejects.toMatchObject({ code: "COMMERCIAL_SURFACE_TEXT_ONLY", status: 503 });
    await expect(service.reportClientEvent(customerId, "order-1", {
      eventType: "heartbeat",
      clientEventId: "text-only-blocked",
      claimedAt: new Date().toISOString()
    })).rejects.toMatchObject({ code: "COMMERCIAL_SURFACE_TEXT_ONLY", status: 503 });

    expect(prisma.voiceSession.findUnique).not.toHaveBeenCalled();
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.voiceAttendanceEvent.create).not.toHaveBeenCalled();
  });

  it("keeps bilateral case text while redacting historical TRTC facts and attachments on a text-only surface", async () => {
    const { service, prisma, caseEvidence } = createHarness({ COMMERCIAL_SURFACE: "text_only" });
    const now = new Date("2026-08-10T00:00:00.000Z");
    const dispute = {
      id: "case-text-only-history",
      orderId: "order-1",
      openedByUserId: customerId,
      openedByRole: "customer",
      counterpartyUserId: companionId,
      issue: "companionAbsent",
      status: "review",
      policyVersionSnapshot: "fulfillment-test-v1",
      timezoneSnapshot: "Asia/Shanghai",
      evidenceDueAt: now,
      counterpartyResponseDueAt: now,
      appealDeadlineAt: null,
      appealResponseDueAt: null,
      decision: null,
      decisionReason: null,
      decidedAt: null,
      appealedAt: null,
      appealedByUserId: null,
      finalDecision: null,
      finalReason: null,
      finalizedAt: null,
      assignedToUserId: "staff-1",
      decidedByUserId: "staff-1",
      appealAssignedToUserId: null,
      appealReviewedByUserId: null,
      refundTransaction: null,
      statements: [{
        id: "statement-history",
        submittedByUserId: customerId,
        kind: "evidence",
        statement: "我在约定时间已进入文字服务页面并等待。",
        evidenceAttachments: [{ id: "legacy-media-attachment" }],
        createdAt: now
      }],
      createdAt: now,
      updatedAt: now,
      order: {
        id: "order-1",
        status: "completed",
        scheduledAt: now,
        durationMinutes: 30,
        serviceOfferingTitleSnapshot: "文字陪伴",
        voiceSession: { id: "voice-history" },
        companion: { ownerUserId: companionId }
      }
    };
    prisma.attendanceDispute.findUnique.mockResolvedValue(dispute);

    const customerResult: any = await service.getForParticipant(customerId, "case-text-only-history");
    const companionResult: any = await service.getForParticipant(companionId, "case-text-only-history");
    const staffResult: any = await service.getForStaff(
      { id: "staff-1", role: "admin" } as any,
      "case-text-only-history"
    );

    for (const result of [customerResult, companionResult, staffResult]) {
      expect(result.attendanceSummary).toEqual(expect.objectContaining({
        providerEvidenceAvailable: false,
        providerRoomEvents: 0,
        auxiliaryClientEvents: 0,
        customer: expect.objectContaining({ trustedProviderEvents: 0, firstJoinedAt: null }),
        companion: expect.objectContaining({ trustedProviderEvents: 0, firstJoinedAt: null })
      }));
      expect(result.statements).toEqual([expect.objectContaining({
        statement: "我在约定时间已进入文字服务页面并等待。",
        evidenceAttachments: []
      })]);
    }
    expect(caseEvidence.attachmentDtos).toHaveBeenCalledWith(dispute.statements[0]);
    expect(prisma.voiceAttendanceEvent.groupBy).not.toHaveBeenCalled();
  });

  it("serializes and bounds auxiliary client events without breaking idempotent retries", async () => {
    const { service, prisma, tx } = createHarness();
    const order = {
      id: "order-1",
      userId: customerId,
      durationMinutes: 30,
      companion: { ownerUserId: companionId },
      voiceSession: { id: "voice-1" }
    };
    prisma.order.findFirst.mockResolvedValue(order);
    tx.voiceAttendanceEvent.findFirst.mockResolvedValue(null);
    // A 30-minute service emits at most 60 expected heartbeats plus a bounded
    // allowance for join, leave, and reconnect events.
    tx.voiceAttendanceEvent.count.mockResolvedValue(80);

    await expect(service.reportClientEvent(customerId, "order-1", {
      eventType: "heartbeat",
      clientEventId: "heartbeat_limit_0001",
      claimedAt: new Date().toISOString()
    })).rejects.toMatchObject({
      code: "ATTENDANCE_CLIENT_EVENT_LIMIT_REACHED",
      status: 429
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.voiceAttendanceEvent.create).not.toHaveBeenCalled();

    const duplicate = {
      id: "event-existing",
      type: "heartbeat",
      source: "client",
      serverReceivedAt: new Date()
    };
    tx.voiceAttendanceEvent.findFirst.mockResolvedValue(duplicate);
    await expect(service.reportClientEvent(customerId, "order-1", {
      eventType: "heartbeat",
      clientEventId: "heartbeat_limit_0001",
      claimedAt: new Date().toISOString()
    })).resolves.toMatchObject({ id: "event-existing", evidenceWeight: "auxiliaryOnly" });
    expect(tx.voiceAttendanceEvent.count).toHaveBeenCalledTimes(1);
  });

  it("aggregates large attendance evidence sets in the database instead of materializing events", async () => {
    const { service, prisma } = createHarness();
    const joinedAt = new Date("2026-08-01T01:00:00.000Z");
    const rejoinedAt = new Date("2026-08-01T01:10:00.000Z");
    const leftAt = new Date("2026-08-01T01:30:00.000Z");
    prisma.voiceAttendanceEvent.groupBy.mockResolvedValue([
      {
        source: "provider", participantRole: "customer", type: "join",
        _count: { _all: 125_000 }, _min: { providerOccurredAt: joinedAt }, _max: { providerOccurredAt: joinedAt }
      },
      {
        source: "provider", participantRole: "customer", type: "reconnect",
        _count: { _all: 25_000 }, _min: { providerOccurredAt: rejoinedAt }, _max: { providerOccurredAt: rejoinedAt }
      },
      {
        source: "provider", participantRole: "customer", type: "leave",
        _count: { _all: 1 }, _min: { providerOccurredAt: leftAt }, _max: { providerOccurredAt: leftAt }
      },
      {
        source: "provider", participantRole: "system", type: "roomStarted",
        _count: { _all: 2 }, _min: { providerOccurredAt: joinedAt }, _max: { providerOccurredAt: leftAt }
      },
      {
        source: "client", participantRole: "customer", type: "heartbeat",
        _count: { _all: 500 }, _min: { providerOccurredAt: null }, _max: { providerOccurredAt: null }
      }
    ]);

    const summary = await (service as any).attendanceSummary({
      order: { voiceSession: { id: "voice-large" } }
    });

    expect(summary).toMatchObject({
      providerEvidenceAvailable: true,
      providerRoomEvents: 2,
      auxiliaryClientEvents: 500,
      customer: {
        trustedProviderEvents: 150_001,
        firstJoinedAt: joinedAt.toISOString(),
        lastLeftAt: leftAt.toISOString(),
        joinCount: 125_000,
        reconnectCount: 25_000,
        leaveCount: 1,
        auxiliaryClientEvents: 500
      }
    });
    expect(prisma.voiceAttendanceEvent.findMany).not.toHaveBeenCalled();
  });

  it("loads a participant page and all attendance summaries without per-case detail queries", async () => {
    const { service, prisma } = createHarness();
    const now = new Date("2026-08-01T01:00:00.000Z");
    const record = (id: string, sessionId: string, openedByUserId: string) => ({
      id,
      orderId: `order-${id}`,
      openedByUserId,
      openedByRole: "customer",
      counterpartyUserId: companionId,
      issue: "technicalFailure",
      status: "review",
      policyVersionSnapshot: "fulfillment-test-v1",
      timezoneSnapshot: "Asia/Shanghai",
      evidenceDueAt: now,
      counterpartyResponseDueAt: now,
      appealDeadlineAt: null,
      appealResponseDueAt: null,
      appealedAt: null,
      decision: null,
      finalDecision: null,
      refundTransaction: null,
      statements: [],
      createdAt: now,
      updatedAt: now,
      order: {
        id: `order-${id}`,
        status: "paid",
        scheduledAt: now,
        durationMinutes: 30,
        serviceOfferingTitleSnapshot: "语音陪伴",
        voiceSession: { id: sessionId },
        companion: { ownerUserId: companionId }
      }
    });
    prisma.attendanceDispute.findMany.mockResolvedValue([
      record("case-1", "voice-1", customerId),
      record("case-2", "voice-2", customerId)
    ]);
    prisma.attendanceDispute.count.mockResolvedValue(2);
    prisma.voiceAttendanceEvent.groupBy.mockResolvedValue([
      {
        voiceSessionId: "voice-1", source: "provider", participantRole: "customer", type: "join",
        _count: { _all: 1 }, _min: { providerOccurredAt: now }, _max: { providerOccurredAt: now }
      },
      {
        voiceSessionId: "voice-2", source: "client", participantRole: "customer", type: "heartbeat",
        _count: { _all: 60 }, _min: { providerOccurredAt: null }, _max: { providerOccurredAt: null }
      }
    ]);

    const result: any = await service.listMine(customerId, { page: 1, pageSize: 20 });

    expect(result.pagination).toMatchObject({ total: 2, totalPages: 1 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: "case-1",
      viewerRole: "customer",
      attendanceSummary: { providerEvidenceAvailable: true }
    });
    expect(result.items[1]).toMatchObject({
      id: "case-2",
      attendanceSummary: { auxiliaryClientEvents: 60 }
    });
    expect(prisma.attendanceDispute.findUnique).not.toHaveBeenCalled();
    expect(prisma.voiceAttendanceEvent.groupBy).toHaveBeenCalledTimes(1);

    const textOnly = createHarness({ COMMERCIAL_SURFACE: "text_only" });
    textOnly.prisma.attendanceDispute.findMany.mockResolvedValue([
      record("case-text-only", "voice-history", customerId)
    ]);
    textOnly.prisma.attendanceDispute.count.mockResolvedValue(1);

    const textOnlyResult: any = await textOnly.service.listMine(customerId, { page: 1, pageSize: 20 });

    expect(textOnlyResult.items[0].attendanceSummary).toMatchObject({
      providerEvidenceAvailable: false,
      providerRoomEvents: 0,
      auxiliaryClientEvents: 0
    });
    expect(textOnly.prisma.voiceAttendanceEvent.groupBy).not.toHaveBeenCalled();
  });

  it("creates an independent structured case and freezes settlement under the canonical order lock", async () => {
    const { service, prisma, tx, audit, commercial, notifications } = createHarness();
    const scheduledAt = new Date(Date.now() - 15 * 60_000);
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: customerId,
      status: "paid",
      scheduledAt,
      durationMinutes: 30,
      fulfillmentPolicyVersionSnapshot: "fulfillment-test-v1",
      fulfillmentTimezoneSnapshot: "Asia/Shanghai",
      companion: { ownerUserId: companionId }
    });
    tx.attendanceDispute.findUnique.mockResolvedValue(null);
    tx.attendanceDispute.create.mockResolvedValue({ id: "case-1" });
    prisma.attendanceDispute.findUnique.mockResolvedValue({
      id: "case-1",
      orderId: "order-1",
      openedByUserId: customerId,
      openedByRole: "customer",
      counterpartyUserId: companionId,
      issue: "companionAbsent",
      status: "counterpartyResponse",
      policyVersionSnapshot: "fulfillment-test-v1",
      timezoneSnapshot: "Asia/Shanghai",
      evidenceDueAt: new Date(),
      counterpartyResponseDueAt: new Date(),
      appealDeadlineAt: null,
      appealResponseDueAt: null,
      appealedAt: null,
      decision: null,
      finalDecision: null,
      refundTransaction: null,
      statements: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      order: {
        id: "order-1",
        status: "paid",
        scheduledAt,
        durationMinutes: 30,
        serviceOfferingTitleSnapshot: "语音陪伴",
        voiceSession: null,
        companion: { ownerUserId: companionId }
      }
    });

    await service.create(
      { id: customerId, role: "user" },
      "order-1",
      { issue: "companionAbsent", statement: "我已按约等待十分钟，对方仍未进入房间。" }
    );

    expect(commercial.holdForOrder).toHaveBeenCalledWith("order-1", "attendance_dispute", tx);
    expect(tx.attendanceDispute.create.mock.calls[0][0].data).toMatchObject({
      issue: "companionAbsent",
      status: "counterpartyResponse",
      openedByRole: "customer",
      counterpartyUserId: companionId
    });
    expect(notifications.createTransactional).toHaveBeenCalledWith(tx, expect.objectContaining({
      userId: companionId,
      type: "supportUpdate",
      eventKey: `attendance:case-1:opened:${companionId}`,
      data: { orderId: "order-1", attendanceDisputeId: "case-1" }
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "attendance.case_created",
      subjectUserIds: [customerId, companionId],
      metadata: expect.objectContaining({
        openedByUserId: customerId,
        counterpartyUserId: companionId
      })
    }), tx);
  });

  it("does not open an absence case before the published ten-minute wait has elapsed", async () => {
    const { service, tx } = createHarness();
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: customerId,
      status: "paid",
      scheduledAt: new Date(Date.now() - 5 * 60_000),
      durationMinutes: 30,
      fulfillmentPolicyVersionSnapshot: "fulfillment-test-v1",
      fulfillmentTimezoneSnapshot: "Asia/Shanghai",
      companion: { ownerUserId: companionId }
    });

    await expect(service.create(
      { id: customerId, role: "user" },
      "order-1",
      { issue: "companionAbsent", statement: "我已进入订单页面，但公开等待期还没有结束。" }
    )).rejects.toMatchObject({ code: "ATTENDANCE_CASE_WINDOW_CLOSED" });
    expect(tx.attendanceDispute.create).not.toHaveBeenCalled();
  });

  it("keeps the stable case detail available to the assigned companion but hidden from unrelated users", async () => {
    const { service, prisma } = createHarness();
    const now = new Date();
    prisma.attendanceDispute.findUnique.mockResolvedValue({
      id: "case-companion-1",
      orderId: "order-1",
      openedByUserId: customerId,
      openedByRole: "customer",
      counterpartyUserId: companionId,
      issue: "companionAbsent",
      status: "counterpartyResponse",
      policyVersionSnapshot: "fulfillment-test-v1",
      timezoneSnapshot: "Asia/Shanghai",
      evidenceDueAt: new Date(now.getTime() + 60 * 60_000),
      counterpartyResponseDueAt: new Date(now.getTime() + 2 * 60 * 60_000),
      appealDeadlineAt: null,
      appealResponseDueAt: null,
      appealedAt: null,
      decision: null,
      finalDecision: null,
      refundTransaction: null,
      statements: [],
      createdAt: now,
      updatedAt: now,
      order: {
        id: "order-1",
        status: "paid",
        scheduledAt: now,
        durationMinutes: 30,
        serviceOfferingTitleSnapshot: "语音陪伴",
        voiceSession: null,
        companion: { ownerUserId: companionId }
      }
    });

    await expect(service.getForParticipant(companionId, "case-companion-1"))
      .resolves.toMatchObject({
        id: "case-companion-1",
        viewerRole: "companion",
        order: { id: "order-1" },
        status: "counterpartyResponse"
      });
    await expect(service.getForParticipant("unrelated-user", "case-companion-1"))
      .rejects.toMatchObject({ code: "ATTENDANCE_CASE_NOT_FOUND" });
  });

  it("prevents the initial reviewer from claiming the appeal", async () => {
    const { service, tx } = createHarness();
    tx.attendanceDispute.findUnique.mockResolvedValue({
      id: "case-1",
      status: "appealed",
      decidedByUserId: "staff-1",
      appealAssignedToUserId: null
    });

    await expect(service.claimAppeal({ id: "staff-1", role: "support" }, "case-1"))
      .rejects.toMatchObject({ code: "ATTENDANCE_APPEAL_INDEPENDENT_REVIEW_REQUIRED" });
  });

  it("uses an independent appeal reviewer and exposes a refund as pending until the payment workflow confirms success", async () => {
    const { service, prisma, tx, audit, payments, commercial } = createHarness();
    const scheduledAt = new Date(Date.now() - 60 * 60_000);
    const baseCase = {
      id: "case-1",
      orderId: "order-1",
      openedByUserId: customerId,
      openedByRole: "customer",
      counterpartyUserId: companionId,
      issue: "companionAbsent",
      status: "appealed",
      policyVersionSnapshot: "fulfillment-test-v1",
      timezoneSnapshot: "Asia/Shanghai",
      evidenceDueAt: new Date(),
      counterpartyResponseDueAt: new Date(),
      appealDeadlineAt: new Date(Date.now() + 60 * 60_000),
      appealResponseDueAt: new Date(Date.now() + 60 * 60_000),
      assignedToUserId: "staff-1",
      decidedByUserId: "staff-1",
      decision: "noRefund",
      decisionReason: "首轮认为渠道事实不足以支持退款。",
      decidedAt: new Date(),
      appealedByUserId: customerId,
      appealedAt: new Date(),
      appealAssignedToUserId: "staff-2",
      appealReviewedByUserId: null,
      finalDecision: null,
      finalReason: null,
      finalizedAt: null,
      refundTransactionId: null
    };
    tx.attendanceDispute.findUnique.mockResolvedValue(baseCase);
    tx.attendanceDisputeStatement.count.mockResolvedValue(1);
    tx.attendanceDispute.update.mockResolvedValue({
      ...baseCase,
      status: "final",
      finalDecision: "fullRefund",
      finalReason: "复核确认陪伴者未在公开等待期内进入房间。",
      appealReviewedByUserId: "staff-2",
      finalizedAt: new Date()
    });
    payments.requestAttendanceDisputeRefund.mockResolvedValue({
      refund: { id: "refund-1", status: "pendingReview" }
    });
    prisma.attendanceDispute.update.mockResolvedValue({
      ...baseCase,
      status: "final",
      finalDecision: "fullRefund",
      refundTransactionId: "refund-1"
    });
    prisma.attendanceDispute.findUnique.mockResolvedValue({
      ...baseCase,
      status: "final",
      finalDecision: "fullRefund",
      finalReason: "复核确认陪伴者未在公开等待期内进入房间。",
      finalizedAt: new Date(),
      appealReviewedByUserId: "staff-2",
      refundTransactionId: "refund-1",
      refundTransaction: {
        id: "refund-1",
        status: "pendingReview",
        amountCents: 9900,
        providerRefundId: null,
        updatedAt: new Date()
      },
      statements: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      order: {
        id: "order-1",
        status: "paid",
        scheduledAt,
        durationMinutes: 30,
        serviceOfferingTitleSnapshot: "语音陪伴",
        voiceSession: null,
        companion: { ownerUserId: companionId }
      }
    });

    const result: any = await service.finalize(
      { id: "staff-2", role: "support" },
      "case-1",
      { decision: "fullRefund", reason: "复核确认陪伴者未在公开等待期内进入房间。" }
    );

    expect(payments.requestAttendanceDisputeRefund).toHaveBeenCalledWith(
      "staff-2",
      "case-1",
      "attendance_dispute:companionAbsent"
    );
    expect(prisma.attendanceDispute.update).toHaveBeenCalledWith({
      where: { id: "case-1" },
      data: { refundTransactionId: "refund-1" }
    });
    expect(commercial.reconcileOrderEarning).toHaveBeenCalledWith("order-1");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "attendance.case_finalized",
      subjectUserIds: [customerId, companionId, "staff-1"]
    }), tx);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "attendance.refund_workflow_started",
      subjectUserIds: [customerId, companionId]
    }));
    expect(result.refund).toMatchObject({
      id: "refund-1",
      status: "pendingReview",
      successConfirmedAt: null
    });
  });

  it("does not let a second reviewer claim an appeal before the counterparty response window closes", async () => {
    const { service, tx } = createHarness();
    tx.attendanceDispute.findUnique.mockResolvedValue({
      id: "case-1",
      status: "appealed",
      decidedByUserId: "staff-1",
      appealAssignedToUserId: null,
      appealResponseDueAt: new Date(Date.now() + 60 * 60_000)
    });
    tx.attendanceDisputeStatement.count.mockResolvedValue(0);

    await expect(service.claimAppeal({ id: "staff-2", role: "support" }, "case-1"))
      .rejects.toMatchObject({ code: "ATTENDANCE_APPEAL_RESPONSE_WINDOW_OPEN" });
  });

  it("keeps the counterparty out of the evidence-only phase instead of ending collection early", async () => {
    const { service, tx } = createHarness();
    tx.attendanceDispute.findUnique.mockResolvedValue({
      id: "case-1",
      openedByUserId: customerId,
      counterpartyUserId: companionId,
      status: "evidenceCollection",
      evidenceDueAt: new Date(Date.now() + 60 * 60_000)
    });
    tx.attendanceDisputeStatement.count.mockResolvedValue(0);

    await expect(service.submitStatement(companionId, "case-1", { statement: "我会在答辩窗口开放后提交事实说明。" }))
      .rejects.toMatchObject({ code: "ATTENDANCE_RESPONSE_NOT_OPEN" });
    expect(tx.attendanceDispute.update).not.toHaveBeenCalled();
  });

  it("rejects evidence-bearing statements and appeals before either transaction can mutate a case", async () => {
    const { service, prisma, caseEvidence, audit, notifications } = createHarness();
    const unavailable = Object.assign(new Error("case evidence disabled"), {
      code: "MEDIA_FEATURE_DISABLED",
      status: 503
    });
    caseEvidence.assertAttachmentsAllowed.mockImplementation(() => {
      throw unavailable;
    });
    const dto = {
      statement: "我需要补充可核对的文字事实。",
      evidenceAssetIds: ["11111111-1111-4111-8111-111111111111"]
    };

    await expect(service.submitStatement(customerId, "case-1", dto)).rejects.toBe(unavailable);
    await expect(service.appeal(customerId, "case-1", dto)).rejects.toBe(unavailable);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(caseEvidence.bindAttendanceStatement).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.createTransactional).not.toHaveBeenCalled();
  });

  it("publishes the wait, manual review, no-recording and client-evidence limits", () => {
    const { service } = createHarness();
    expect(service.policy()).toMatchObject({
      waitMinutes: 10,
      recording: expect.stringContaining("not recorded"),
      insufficientEvidence: expect.stringContaining("reviewed by staff"),
      clientEvidence: expect.stringContaining("never decide")
    });
  });
});
