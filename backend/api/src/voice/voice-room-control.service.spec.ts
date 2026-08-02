import { VoiceRoomControlService } from "./voice-room-control.service";

describe("VoiceRoomControlService", () => {
  const controlConfig: Record<string, unknown> = {
    TRTC_ROOM_CONTROL_ENABLED: true,
    TRTC_SDK_APP_ID: 1400000001,
    TRTC_CONTROL_REGION: "ap-guangzhou",
    TRTC_CONTROL_TIMEOUT_MS: 5_000,
    TENCENTCLOUD_SECRET_ID: "AKID_test_voice_control",
    TENCENTCLOUD_SECRET_KEY: "tencent-cloud-control-secret-material",
    TENCENTCLOUD_SECURITY_TOKEN: ""
  };

  let configValues: Record<string, unknown>;
  let prisma: any;
  let audit: any;
  let service: VoiceRoomControlService;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  const voiceSession = {
    id: "voice-session-1",
    orderId: "order-1",
    roomId: "tt_voice_order1",
    terminationCompletedAt: null,
    terminationLeaseUntil: null
  };

  beforeEach(() => {
    configValues = { ...controlConfig };
    prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const query = Array.from(strings).join("");
        if (query.includes('UPDATE "VoiceRoomControlDispatchLease"')) {
          return Promise.resolve([{ id: "talk-and-talk:trtc-room-control-dispatch" }]);
        }
        return Promise.resolve([]);
      }),
      $executeRaw: jest.fn().mockResolvedValue(1),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          userId: "customer-1",
          companion: { ownerUserId: "companion-owner-1" }
        })
      },
      voiceSession: {
        findUnique: jest.fn().mockResolvedValue(voiceSession),
        update: jest.fn().mockImplementation(async ({ data }: { data: { terminationReason: string } }) => ({
          id: voiceSession.id,
          orderId: voiceSession.orderId,
          roomId: voiceSession.roomId,
          terminationReason: data.terminationReason,
          terminationAttempts: 1,
          terminationLeaseUntil: new Date(Date.now() + 3 * 60_000)
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new VoiceRoomControlService(
      prisma,
      { get: jest.fn((key: string, fallback?: unknown) => configValues[key] ?? fallback) } as any,
      audit
    );
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ Response: { RequestId: "request-voice-1" } })
    } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("signs and dispatches a server-only room dismissal after a refund without leaking cloud secrets", async () => {
    const result = await service.terminateForOrder("order-1", "refund_requested");

    expect(result).toEqual({ state: "terminated", requestId: "request-voice-1", alreadyAbsent: false });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    const lockQuery = Array.from(prisma.$queryRaw.mock.calls[0][0] as string[]).join("");
    expect(lockQuery).toContain('SELECT "id" FROM "VoiceSession"');
    expect(lockQuery).toContain("FOR UPDATE");
    const dispatchLeaseQuery = Array.from(prisma.$queryRaw.mock.calls[1][0] as string[]).join("");
    expect(dispatchLeaseQuery).toContain('UPDATE "VoiceRoomControlDispatchLease"');
    expect(fetchSpy).toHaveBeenCalledWith("https://trtc.tencentcloudapi.com/", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ SdkAppId: 1400000001, RoomId: "tt_voice_order1" })
    }));
    const request = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = request.headers as Record<string, string>;
    expect(headers["x-tc-action"]).toBe("DismissRoomByStrRoomId");
    expect(headers["x-tc-version"]).toBe("2019-07-22");
    expect(headers.authorization).toContain("TC3-HMAC-SHA256 Credential=AKID_test_voice_control/");
    expect(headers.authorization).not.toContain("tencent-cloud-control-secret-material");
    expect(prisma.voiceSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        terminationCompletedAt: expect.any(Date),
        terminationLastError: null,
        terminationProviderRequestId: "request-voice-1"
      })
    }));
    const auditPayload = audit.record.mock.calls[0][0];
    expect(auditPayload).toEqual(expect.objectContaining({ action: "voice.room_terminated", resourceId: "order-1" }));
    expect(JSON.stringify(auditPayload)).not.toContain("tencent-cloud-control-secret-material");
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it("treats an already absent provider room as a successful, idempotent close", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        Response: { RequestId: "request-room-absent", Error: { Code: "FailedOperation.RoomNotExist" } }
      })
    } as Response);

    await expect(service.terminateForOrder("order-1", "service_completed")).resolves.toEqual({
      state: "terminated",
      requestId: "request-room-absent",
      alreadyAbsent: true
    });
    expect(prisma.voiceSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ terminationCompletedAt: expect.any(Date), terminationLastError: null })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ alreadyAbsent: true, reason: "service_completed" })
    }));
  });

  it("does not mistake an uncorrelated already-absent response for a completed room close", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        Response: { Error: { Code: "FailedOperation.RoomNotExist" } }
      })
    } as Response);

    await expect(service.terminateForOrder("order-1", "service_completed")).resolves.toEqual({
      state: "retry_scheduled"
    });
    expect(prisma.voiceSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        terminationLastError: "provider_invalid_response"
      })
    }));
    expect(prisma.voiceSession.updateMany.mock.calls[0][0].data).not.toHaveProperty("terminationCompletedAt");
  });

  it("persists a bounded retry without exposing a provider error body", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({
        Response: {
          RequestId: "request-denied",
          Error: { Code: "UnauthorizedOperation.SdkAppId", Message: "secret=must-never-persist" }
        }
      })
    } as Response);

    await expect(service.terminateForOrder("order-1", "refund_requested")).resolves.toEqual({
      state: "retry_scheduled"
    });
    expect(prisma.voiceSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        terminationLeaseUntil: null,
        terminationNextAttemptAt: expect.any(Date),
        terminationLastError: "UnauthorizedOperation.SdkAppId"
      })
    }));
    const auditPayload = audit.record.mock.calls[0][0];
    expect(auditPayload.action).toBe("voice.room_termination_retry_scheduled");
    expect(JSON.stringify(auditPayload)).not.toContain("must-never-persist");
  });

  it("does not mistake an uncorrelated HTTP 200 response for a completed room close", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html>upstream proxy response</html>"
    } as Response);

    await expect(service.terminateForOrder("order-1", "refund_requested")).resolves.toEqual({
      state: "retry_scheduled"
    });
    expect(prisma.voiceSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ terminationLastError: "provider_invalid_response" })
    }));
  });

  it("holds a durable cross-replica dispatch lease and keeps the provider batch bounded", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ acquired: "true" }])
      .mockResolvedValueOnce([{ id: "talk-and-talk:trtc-room-control-dispatch" }])
      .mockResolvedValueOnce([{ ...voiceSession, reason: "service_window_elapsed" }]);
    prisma.voiceSession.update.mockResolvedValueOnce({
      id: voiceSession.id,
      orderId: voiceSession.orderId,
      roomId: voiceSession.roomId,
      terminationReason: "service_window_elapsed",
      terminationAttempts: 1,
      terminationLeaseUntil: new Date(Date.now() + 3 * 60_000)
    });

    await expect(service.dismissDueRooms(999)).resolves.toEqual({
      skipped: false,
      claimed: 1,
      terminated: 1,
      retriesScheduled: 0
    });
    const lockQuery = Array.from(prisma.$queryRaw.mock.calls[0][0] as string[]).join("");
    const dispatchLeaseQuery = Array.from(prisma.$queryRaw.mock.calls[1][0] as string[]).join("");
    const dueQuery = Array.from(prisma.$queryRaw.mock.calls[2][0] as string[]).join("");
    expect(lockQuery).toContain("pg_try_advisory_xact_lock");
    expect(dispatchLeaseQuery).toContain('UPDATE "VoiceRoomControlDispatchLease"');
    expect(dueQuery).toContain("FOR UPDATE OF voice SKIP LOCKED");
    expect(dueQuery).toContain("GREATEST(orders");
    expect(prisma.$queryRaw.mock.calls[2]).toContain(10);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const claimedLease = prisma.voiceSession.update.mock.calls[0][0].data.terminationLeaseUntil as Date;
    expect(claimedLease.getTime()).toBeGreaterThan(Date.now() + 170_000);
  });

  it("drains every recorded room under the temporary emergency stop without minting new access", async () => {
    configValues.TRTC_EMERGENCY_STOP_ENABLED = true;
    prisma.$queryRaw
      .mockResolvedValueOnce([{ acquired: "true" }])
      .mockResolvedValueOnce([{ id: "talk-and-talk:trtc-room-control-dispatch" }])
      .mockResolvedValueOnce([{ ...voiceSession, reason: "emergency_stop" }]);
    prisma.voiceSession.update.mockResolvedValueOnce({
      id: voiceSession.id,
      orderId: voiceSession.orderId,
      roomId: voiceSession.roomId,
      terminationReason: "emergency_stop",
      terminationAttempts: 1,
      terminationLeaseUntil: new Date(Date.now() + 3 * 60_000)
    });

    await expect(service.dismissDueRooms(10)).resolves.toEqual({
      skipped: false,
      claimed: 1,
      terminated: 1,
      retriesScheduled: 0
    });

    const dueQuery = Array.from(prisma.$queryRaw.mock.calls[2][0] as string[]).join("");
    expect(dueQuery).toContain("emergency_stop");
    expect(dueQuery).toContain('COALESCE(voice."terminationReason", \'\')');
    expect(prisma.voiceSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ terminationReason: "emergency_stop" })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ reason: "emergency_stop" })
    }));
  });

  it("does not leave an emergency room behind an old exponential retry", async () => {
    configValues.TRTC_EMERGENCY_STOP_ENABLED = true;
    prisma.$queryRaw
      .mockResolvedValueOnce([{ acquired: "true" }])
      .mockResolvedValueOnce([{ id: "talk-and-talk:trtc-room-control-dispatch" }])
      .mockResolvedValueOnce([{ ...voiceSession, reason: "emergency_stop" }]);
    prisma.voiceSession.update.mockResolvedValueOnce({
      id: voiceSession.id,
      orderId: voiceSession.orderId,
      roomId: voiceSession.roomId,
      terminationReason: "emergency_stop",
      terminationAttempts: 6,
      terminationLeaseUntil: new Date(Date.now() + 3 * 60_000)
    });
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ Response: { RequestId: "request-emergency-retry" } })
    } as Response);

    await expect(service.dismissDueRooms(10)).resolves.toEqual({
      skipped: false,
      claimed: 1,
      terminated: 0,
      retriesScheduled: 1
    });

    const retryAt = prisma.voiceSession.updateMany.mock.calls[0][0].data.terminationNextAttemptAt as Date;
    expect(retryAt.getTime()).toBeGreaterThan(Date.now() + 10_000);
    expect(retryAt.getTime()).toBeLessThan(Date.now() + 20_000);
  });

  it("does not dispatch another batch while a different replica holds the durable lease", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ acquired: "true" }])
      .mockResolvedValueOnce([]);

    await expect(service.dismissDueRooms(10)).resolves.toEqual({
      skipped: true,
      claimed: 0,
      terminated: 0,
      retriesScheduled: 0
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.voiceSession.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not let inline refund or completion closures bypass a worker-held provider lease", async () => {
    prisma.$queryRaw.mockImplementationOnce(() => Promise.resolve([]));
    prisma.$queryRaw.mockImplementationOnce(() => Promise.resolve([]));

    await expect(service.terminateForOrder("order-1", "refund_requested")).resolves.toEqual({
      state: "retry_scheduled"
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.voiceSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not open a database transaction while room control is disabled", async () => {
    configValues.TRTC_ROOM_CONTROL_ENABLED = false;

    await expect(service.terminateForOrder("order-1", "refund_requested")).resolves.toEqual({ state: "disabled" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
