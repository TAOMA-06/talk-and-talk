import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, randomUUID } from "node:crypto";

import { AuditService } from "../common/audit/audit.service";
import { PrismaService } from "../database/prisma.service";

export type VoiceRoomTerminationReason =
  | "refund_requested"
  | "service_completed"
  | "service_window_elapsed"
  | "order_cancelled"
  | "order_refunded"
  | "emergency_stop";

type TrtcRoomControlRuntime = {
  sdkAppId: number;
  secretId: string;
  secretKey: string;
  securityToken: string;
  region: "ap-beijing" | "ap-guangzhou";
  timeoutMs: number;
};

type VoiceRoomTerminationClaim = {
  id: string;
  orderId: string;
  roomId: string;
  reason: VoiceRoomTerminationReason;
  attempts: number;
  leaseUntil: Date;
};

type VoiceRoomTerminationBatch = {
  claims: VoiceRoomTerminationClaim[];
  dispatchLeaseToken: string | null;
};

type DismissRoomResult = {
  requestId: string | null;
  alreadyAbsent: boolean;
};

type TerminationResult = {
  state: "disabled" | "not_due" | "terminated" | "retry_scheduled";
  requestId?: string | null;
  alreadyAbsent?: boolean;
};

class TrtcRoomControlError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const TRTC_API_HOST = "trtc.tencentcloudapi.com";
const TRTC_API_ENDPOINT = `https://${TRTC_API_HOST}/`;
const TRTC_API_ACTION = "DismissRoomByStrRoomId";
const TRTC_API_VERSION = "2019-07-22";
const TRTC_API_SERVICE = "trtc";
const TRTC_API_CONTENT_TYPE = "application/json; charset=utf-8";
// The provider allows 20 calls/s. A database-backed lease stays held while a
// batch is sent so autoscaled Cloud Run replicas cannot each dispatch their
// own "bounded" batch concurrently. It safely exceeds the 10 × 10 s worst
// case provider timeout plus a small scheduling buffer.
const GLOBAL_DISPATCH_LEASE_ID = "talk-and-talk:trtc-room-control-dispatch";
const GLOBAL_DISPATCH_LEASE_MS = 3 * 60_000;
// Every claimed room needs the same safety window. Otherwise a late item in a
// serial batch could lose its row lease before its own provider call starts,
// allowing an inline refund/complete event to claim the same room again.
const TERMINATION_LEASE_MS = GLOBAL_DISPATCH_LEASE_MS;
const MAX_ERROR_CODE_LENGTH = 120;

/**
 * The provider is only a transport. Order/refund state remains authoritative
 * in PostgreSQL; this service turns that state into an idempotent provider-room
 * close command without ever exposing Tencent Cloud API credentials to clients.
 */
@Injectable()
export class VoiceRoomControlService {
  private readonly logger = new Logger(VoiceRoomControlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService
  ) {}

  async terminateForOrder(orderId: string, reason: VoiceRoomTerminationReason): Promise<TerminationResult> {
    const runtime = this.runtimeConfig();
    if (!runtime) return { state: "disabled" };

    try {
      const claim = await this.claimOrderTermination(orderId, reason);
      if (!claim) return { state: "not_due" };
      const dispatchLeaseToken = await this.acquireDispatchLease();
      // Keep the per-room lease claimed above. The worker will retry it after
      // the short lease expires, rather than allowing a refund/complete burst
      // to bypass the provider-wide rate throttle.
      if (!dispatchLeaseToken) return { state: "retry_scheduled" };
      try {
        return await this.executeClaim(claim, runtime);
      } finally {
        await this.releaseDispatchLease(dispatchLeaseToken);
      }
    } catch (error) {
      // A room-control outage must never roll back the financial/order state
      // that already committed. The durable worker will retry a claimed row.
      this.logger.error(`Voice-room termination dispatch failed (${this.errorCode(error)}).`);
      return { state: "retry_scheduled" };
    }
  }

  async dismissDueRooms(limit: number): Promise<{
    skipped: boolean;
    claimed: number;
    terminated: number;
    retriesScheduled: number;
  }> {
    const runtime = this.runtimeConfig();
    if (!runtime) return { skipped: true, claimed: 0, terminated: 0, retriesScheduled: 0 };

    const batch = await this.claimDueTerminations(limit);
    if (!batch.dispatchLeaseToken) {
      return { skipped: true, claimed: 0, terminated: 0, retriesScheduled: 0 };
    }
    let terminated = 0;
    let retriesScheduled = 0;
    try {
      for (const claim of batch.claims) {
        const result = await this.executeClaim(claim, runtime);
        if (result.state === "terminated") terminated += 1;
        if (result.state === "retry_scheduled") retriesScheduled += 1;
      }
    } finally {
      await this.releaseDispatchLease(batch.dispatchLeaseToken);
    }
    return { skipped: false, claimed: batch.claims.length, terminated, retriesScheduled };
  }

  private runtimeConfig(): TrtcRoomControlRuntime | null {
    if (this.config.get<boolean>("TRTC_ROOM_CONTROL_ENABLED", false) !== true) return null;

    const sdkAppId = this.config.get<number>("TRTC_SDK_APP_ID", 0) ?? 0;
    const secretId = this.config.get<string>("TENCENTCLOUD_SECRET_ID", "")?.trim() ?? "";
    const secretKey = this.config.get<string>("TENCENTCLOUD_SECRET_KEY", "")?.trim() ?? "";
    const securityToken = this.config.get<string>("TENCENTCLOUD_SECURITY_TOKEN", "")?.trim() ?? "";
    const region = this.config.get<"ap-beijing" | "ap-guangzhou">("TRTC_CONTROL_REGION", "ap-guangzhou");
    const timeoutMs = this.config.get<number>("TRTC_CONTROL_TIMEOUT_MS", 5_000) ?? 5_000;
    if (!sdkAppId || !secretId || !secretKey || !["ap-beijing", "ap-guangzhou"].includes(region)) {
      throw new Error("TRTC room-control configuration is incomplete");
    }
    return { sdkAppId, secretId, secretKey, securityToken, region, timeoutMs };
  }

  private async claimOrderTermination(
    orderId: string,
    reason: VoiceRoomTerminationReason
  ): Promise<VoiceRoomTerminationClaim | null> {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "VoiceSession" WHERE "orderId" = ${orderId} FOR UPDATE`;
      const session = await db.voiceSession.findUnique({
        where: { orderId },
        select: {
          id: true,
          orderId: true,
          roomId: true,
          terminationCompletedAt: true,
          terminationLeaseUntil: true
        }
      });
      if (
        !session ||
        session.terminationCompletedAt ||
        (session.terminationLeaseUntil && session.terminationLeaseUntil.getTime() > Date.now())
      ) {
        return null;
      }

      const now = new Date();
      const claimed = await db.voiceSession.update({
        where: { id: session.id },
        data: {
          terminationRequestedAt: now,
          terminationReason: reason,
          terminationAttempts: { increment: 1 },
          terminationNextAttemptAt: null,
          terminationLeaseUntil: new Date(now.getTime() + TERMINATION_LEASE_MS),
          terminationLastError: null
        },
        select: {
          id: true,
          orderId: true,
          roomId: true,
          terminationReason: true,
          terminationAttempts: true,
          terminationLeaseUntil: true
        }
      });
      return this.toClaim(claimed, reason);
    }, { maxWait: 5_000, timeout: 10_000 });
  }

  private async claimDueTerminations(limit: number): Promise<VoiceRoomTerminationBatch> {
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 10);
    const emergencyStopEnabled = this.config.get<boolean>("TRTC_EMERGENCY_STOP_ENABLED", false);
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // The transaction lock avoids noisy competing claim setup. The durable
      // dispatch lease below, rather than this short transaction lock, covers
      // the later outbound provider calls across Cloud Run replicas.
      const lockRows = await db.$queryRaw`
        SELECT pg_try_advisory_xact_lock(hashtext('talk-and-talk:voice-room-termination-worker'))::text AS "acquired"
      `;
      if (!Array.isArray(lockRows) || String(lockRows[0]?.acquired).toLowerCase() !== "true") {
        return { claims: [], dispatchLeaseToken: null };
      }

      const now = new Date();
      const dispatchLeaseToken = await this.acquireDispatchLeaseInTransaction(db, now);
      if (!dispatchLeaseToken) {
        return { claims: [], dispatchLeaseToken: null };
      }

      const dueRows = await db.$queryRaw`
        SELECT
          voice."id",
          voice."orderId",
          voice."roomId",
          CASE
            WHEN ${emergencyStopEnabled} THEN 'emergency_stop'
            WHEN EXISTS (
              SELECT 1 FROM "RefundTransaction" AS refund
              WHERE refund."orderId" = voice."orderId"
                AND refund."status" IN ('pendingReview', 'pending', 'processing', 'success', 'failed')
            ) THEN 'refund_requested'
            WHEN orders."status" = 'cancelled' THEN 'order_cancelled'
            WHEN orders."status" = 'refunded' THEN 'order_refunded'
            WHEN orders."status" = 'completed' THEN 'service_completed'
            ELSE 'service_window_elapsed'
          END AS "reason"
        FROM "VoiceSession" AS voice
        INNER JOIN "Order" AS orders ON orders."id" = voice."orderId"
        WHERE voice."terminationCompletedAt" IS NULL
          AND (voice."terminationLeaseUntil" IS NULL OR voice."terminationLeaseUntil" <= NOW())
          AND (
            voice."terminationNextAttemptAt" IS NULL
            OR voice."terminationNextAttemptAt" <= NOW()
            -- An emergency drain must not wait behind an old normal retry.
            -- After this first emergency claim the reason becomes
            -- emergency_stop, so later failures use the bounded retry below.
            OR (${emergencyStopEnabled} AND COALESCE(voice."terminationReason", '') <> 'emergency_stop')
          )
          AND (
            ${emergencyStopEnabled}
            OR EXISTS (
              SELECT 1 FROM "RefundTransaction" AS refund
              WHERE refund."orderId" = voice."orderId"
                AND refund."status" IN ('pendingReview', 'pending', 'processing', 'success', 'failed')
            )
            OR orders."status" IN ('completed', 'cancelled', 'refunded')
            OR GREATEST(orders."scheduledAt", COALESCE(orders."serviceStartedAt", orders."scheduledAt"))
              + orders."durationMinutes" * INTERVAL '1 minute' <= NOW()
          )
        ORDER BY voice."terminationNextAttemptAt" ASC NULLS FIRST, voice."updatedAt" ASC
        LIMIT ${safeLimit}
        FOR UPDATE OF voice SKIP LOCKED
      ` as Array<{ id: string; orderId: string; roomId: string; reason: VoiceRoomTerminationReason }>;

      const claims: VoiceRoomTerminationClaim[] = [];
      for (const due of dueRows) {
        const claimed = await db.voiceSession.update({
          where: { id: due.id },
          data: {
            terminationRequestedAt: now,
            terminationReason: due.reason,
            terminationAttempts: { increment: 1 },
            terminationNextAttemptAt: null,
            terminationLeaseUntil: new Date(now.getTime() + TERMINATION_LEASE_MS),
            terminationLastError: null
          },
          select: {
            id: true,
            orderId: true,
            roomId: true,
            terminationReason: true,
            terminationAttempts: true,
            terminationLeaseUntil: true
          }
        });
        const claim = this.toClaim(claimed, due.reason);
        if (claim) claims.push(claim);
      }
      return { claims, dispatchLeaseToken };
    }, { maxWait: 5_000, timeout: 10_000 });
  }

  private async acquireDispatchLease(): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      return this.acquireDispatchLeaseInTransaction(tx as any, new Date());
    }, { maxWait: 5_000, timeout: 10_000 });
  }

  private async acquireDispatchLeaseInTransaction(db: any, now: Date): Promise<string | null> {
    const dispatchLeaseToken = randomUUID();
    const dispatchLeaseUntil = new Date(now.getTime() + GLOBAL_DISPATCH_LEASE_MS);
    await db.$executeRaw`
      INSERT INTO "VoiceRoomControlDispatchLease" ("id", "createdAt", "updatedAt")
      VALUES (${GLOBAL_DISPATCH_LEASE_ID}, ${now}, ${now})
      ON CONFLICT ("id") DO NOTHING
    `;
    const dispatchLeaseRows = await db.$queryRaw`
      UPDATE "VoiceRoomControlDispatchLease"
      SET "leaseToken" = ${dispatchLeaseToken},
          "leaseUntil" = ${dispatchLeaseUntil},
          "updatedAt" = ${now}
      WHERE "id" = ${GLOBAL_DISPATCH_LEASE_ID}
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${now})
      RETURNING "id"
    ` as Array<{ id: string }>;
    return Array.isArray(dispatchLeaseRows) && dispatchLeaseRows.length === 1
      ? dispatchLeaseToken
      : null;
  }

  private async releaseDispatchLease(dispatchLeaseToken: string): Promise<void> {
    try {
      const now = new Date();
      await this.prisma.$executeRaw`
        UPDATE "VoiceRoomControlDispatchLease"
        SET "leaseToken" = NULL,
            "leaseUntil" = NULL,
            "updatedAt" = ${now}
        WHERE "id" = ${GLOBAL_DISPATCH_LEASE_ID}
          AND "leaseToken" = ${dispatchLeaseToken}
      `;
    } catch {
      // The lease is a safety throttle, not business state. A failed release
      // must not mark a provider result failed or retry a room unnecessarily;
      // another replica can resume when the short durable lease expires.
      this.logger.error("Voice-room dispatch lease release failed.");
    }
  }

  private toClaim(
    session: {
      id: string;
      orderId: string;
      roomId: string;
      terminationReason: string | null;
      terminationAttempts: number;
      terminationLeaseUntil: Date | null;
    },
    fallbackReason: VoiceRoomTerminationReason
  ): VoiceRoomTerminationClaim | null {
    if (!session.terminationLeaseUntil) return null;
    const reason = this.isTerminationReason(session.terminationReason)
      ? session.terminationReason
      : fallbackReason;
    return {
      id: session.id,
      orderId: session.orderId,
      roomId: session.roomId,
      reason,
      attempts: session.terminationAttempts,
      leaseUntil: session.terminationLeaseUntil
    };
  }

  private isTerminationReason(value: string | null): value is VoiceRoomTerminationReason {
    return value === "refund_requested" ||
      value === "service_completed" ||
      value === "service_window_elapsed" ||
      value === "order_cancelled" ||
      value === "order_refunded" ||
      value === "emergency_stop";
  }

  private async executeClaim(
    claim: VoiceRoomTerminationClaim,
    runtime: TrtcRoomControlRuntime
  ): Promise<TerminationResult> {
    try {
      const result = await this.dismissProviderRoom(runtime, claim.roomId);
      const settled = await this.prisma.voiceSession.updateMany({
        where: {
          id: claim.id,
          terminationCompletedAt: null,
          terminationLeaseUntil: claim.leaseUntil
        },
        data: {
          terminationCompletedAt: new Date(),
          terminationLeaseUntil: null,
          terminationNextAttemptAt: null,
          terminationLastError: null,
          terminationProviderRequestId: result.requestId
        }
      });
      if (settled.count > 0) {
        await this.recordAuditSafely({
          action: "voice.room_terminated",
          resourceId: claim.orderId,
          metadata: {
            provider: "trtc",
            roomId: claim.roomId,
            reason: claim.reason,
            attempts: claim.attempts,
            providerRequestId: result.requestId,
            alreadyAbsent: result.alreadyAbsent
          }
        });
      }
      return { state: "terminated", requestId: result.requestId, alreadyAbsent: result.alreadyAbsent };
    } catch (error) {
      const errorCode = this.errorCode(error);
      const retryAt = new Date(Date.now() + this.retryDelayMs(
        claim.attempts,
        claim.reason === "emergency_stop"
      ));
      const settled = await this.prisma.voiceSession.updateMany({
        where: {
          id: claim.id,
          terminationCompletedAt: null,
          terminationLeaseUntil: claim.leaseUntil
        },
        data: {
          terminationLeaseUntil: null,
          terminationNextAttemptAt: retryAt,
          terminationLastError: errorCode
        }
      });
      if (settled.count > 0) {
        await this.recordAuditSafely({
          action: "voice.room_termination_retry_scheduled",
          resourceId: claim.orderId,
          metadata: {
            provider: "trtc",
            roomId: claim.roomId,
            reason: claim.reason,
            attempts: claim.attempts,
            errorCode,
            retryAt: retryAt.toISOString()
          }
        });
      }
      this.logger.warn(`Voice-room termination retry scheduled (${errorCode}).`);
      return { state: "retry_scheduled" };
    }
  }

  private retryDelayMs(attempts: number, emergencyStop = false): number {
    // The global dispatch lease and batch bound keep this 15-second emergency
    // retry below the provider limit. It is intentionally much faster than a
    // normal incident retry so an operator can drain a live room promptly.
    if (emergencyStop) return 15_000;
    const minutes = Math.min(30, 2 ** Math.min(Math.max(attempts - 1, 0), 5));
    return minutes * 60_000;
  }

  private async dismissProviderRoom(runtime: TrtcRoomControlRuntime, roomId: string): Promise<DismissRoomResult> {
    const payload = JSON.stringify({ SdkAppId: runtime.sdkAppId, RoomId: roomId });
    const timestamp = Math.floor(Date.now() / 1_000);
    const authorization = this.authorization(runtime, payload, timestamp);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs);
    try {
      const response = await fetch(TRTC_API_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": TRTC_API_CONTENT_TYPE,
          authorization,
          "x-tc-action": TRTC_API_ACTION,
          "x-tc-version": TRTC_API_VERSION,
          "x-tc-timestamp": String(timestamp),
          "x-tc-region": runtime.region,
          ...(runtime.securityToken ? { "x-tc-token": runtime.securityToken } : {})
        },
        body: payload,
        signal: controller.signal
      });
      const body = this.parseProviderBody(await response.text());
      const providerError = body.Response?.Error;
      const requestId = this.safeRequestId(body.Response?.RequestId);
      if (providerError?.Code === "FailedOperation.RoomNotExist") {
        // A malformed/proxied response must not be accepted as proof that a
        // room is gone. Tencent Cloud returns RequestId for both successful
        // calls and structured API errors, so retain the same evidence bar for
        // this idempotent success path.
        if (!requestId) {
          throw new TrtcRoomControlError("provider_invalid_response");
        }
        return { requestId, alreadyAbsent: true };
      }
      if (!response.ok || providerError?.Code) {
        throw new TrtcRoomControlError(this.safeProviderCode(providerError?.Code, response.status));
      }
      // A generic 2xx proxy response is not proof that TRTC accepted the room
      // close. Require the provider's correlation ID before recording success.
      if (!body.Response || !requestId) {
        throw new TrtcRoomControlError("provider_invalid_response");
      }
      return { requestId, alreadyAbsent: false };
    } finally {
      clearTimeout(timeout);
    }
  }

  private authorization(runtime: TrtcRoomControlRuntime, payload: string, timestamp: number): string {
    const date = new Date(timestamp * 1_000).toISOString().slice(0, 10);
    const canonicalHeaders = [
      `content-type:${TRTC_API_CONTENT_TYPE}`,
      `host:${TRTC_API_HOST}`,
      `x-tc-action:${TRTC_API_ACTION.toLowerCase()}`
    ].join("\n") + "\n";
    const signedHeaders = "content-type;host;x-tc-action";
    const canonicalRequest = [
      "POST",
      "/",
      "",
      canonicalHeaders,
      signedHeaders,
      this.sha256(payload)
    ].join("\n");
    const credentialScope = `${date}/${TRTC_API_SERVICE}/tc3_request`;
    const stringToSign = [
      "TC3-HMAC-SHA256",
      String(timestamp),
      credentialScope,
      this.sha256(canonicalRequest)
    ].join("\n");
    const secretDate = this.hmac(`TC3${runtime.secretKey}`, date);
    const secretService = this.hmac(secretDate, TRTC_API_SERVICE);
    const secretSigning = this.hmac(secretService, "tc3_request");
    const signature = this.hmac(secretSigning, stringToSign).toString("hex");
    return "TC3-HMAC-SHA256 " +
      `Credential=${runtime.secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  private hmac(key: string | Buffer, value: string): Buffer {
    return createHmac("sha256", key).update(value, "utf8").digest();
  }

  private sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  private parseProviderBody(raw: string): { Response?: { RequestId?: unknown; Error?: { Code?: unknown } } } {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? parsed as { Response?: { RequestId?: unknown; Error?: { Code?: unknown } } } : {};
    } catch {
      return {};
    }
  }

  private safeProviderCode(value: unknown, status?: number): string {
    if (typeof value === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(value)) return value;
    return status ? `http_${status}` : "provider_error";
  }

  private safeRequestId(value: unknown): string | null {
    return typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value) ? value : null;
  }

  private errorCode(error: unknown): string {
    if (error instanceof TrtcRoomControlError) return error.code;
    if (error instanceof Error && error.name === "AbortError") return "provider_timeout";
    return "provider_transport_error".slice(0, MAX_ERROR_CODE_LENGTH);
  }

  private async recordAuditSafely(input: {
    action: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: input.resourceId },
        select: {
          userId: true,
          companion: { select: { ownerUserId: true } }
        }
      });
      const subjectUserIds = [order?.userId, order?.companion?.ownerUserId]
        .filter((candidate): candidate is string => Boolean(candidate));
      if (!subjectUserIds.length) {
        throw new Error("Voice room audit is missing its order subjects");
      }
      await this.audit.record({
        actorId: null,
        subjectUserIds,
        action: input.action,
        resourceType: "order",
        resourceId: input.resourceId,
        metadata: input.metadata
      });
    } catch {
      // State has already been durably recorded. Do not turn an audit write
      // outage into a second provider request for the same room.
      this.logger.error("Voice-room termination audit write failed.");
    }
  }
}
