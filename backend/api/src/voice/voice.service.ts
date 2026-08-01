import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { assertCurrentCompanionCommercialEligibility } from "../commercial/companion-commercial-eligibility";
import { PrismaService } from "../database/prisma.service";
import { assertCurrentCustomerAdultEligibility } from "../users/customer-adult-eligibility.service";

type ParticipantRole = "customer" | "companion";

type TrtcSigner = {
  genUserSig(userId: string, ttlSeconds: number): string;
  genPrivateMapKeyWithStringRoomID(
    userId: string,
    ttlSeconds: number,
    roomId: string,
    privilegeMap: number
  ): string;
};

type TrtcSignerModule = {
  Api: new (sdkAppId: number, sdkSecretKey: string) => TrtcSigner;
};

type VoiceRuntimeConfig = {
  sdkAppId: number;
  sdkSecretKey: string;
  userSigTtlSeconds: number;
  privacyNoticeVersion: string;
  privacyDisclosureReference: string;
};

const TRTC_AUDIO_ROOM_PRIVILEGES = 15;
const MIN_JOINABLE_REMAINING_SECONDS = 60;

/**
 * Issues a provider-specific, short-lived credential only after the existing
 * manual order lifecycle has reached "in service". The provider is never an
 * authority for payment, order ownership, duration, or refunds.
 */
@Injectable()
export class VoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService
  ) {}

  async issueRoomAccess(userId: string, orderId: string) {
    const runtime = this.runtimeConfig();
    // Refund creation locks this same order row. Keep authorization, after-sales
    // inspection, room bookkeeping and signing in one short transaction so a
    // credential can never be produced from a mixed pre-/post-refund snapshot.
    const access = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const target = await db.order.findUnique({
        where: { id: orderId },
        select: { companionId: true }
      });
      if (target?.companionId) {
        await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${target.companionId} FOR UPDATE`;
      }
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order: any = await db.order.findFirst({
        where: {
          id: orderId,
          OR: [
            { userId },
            { companion: { ownerUserId: userId } }
          ]
        },
        include: {
          companion: {
            select: {
              ownerUserId: true,
              name: true,
              initials: true
            }
          }
        }
      } as any);

      // Do not reveal that a different participant owns an order.
      if (!order) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${order.userId} FOR UPDATE`;
      if (order.serviceOfferingDeliveryModeSnapshot !== "voice") {
        throw new AppException(
          "VOICE_ORDER_NOT_ELIGIBLE",
          "This order is not a real-time voice service",
          HttpStatus.CONFLICT
        );
      }
      if (!order.companionConfirmedAt) {
        throw new AppException(
          "VOICE_ORDER_NOT_ACCEPTED",
          "The companion must accept the order before voice access is available",
          HttpStatus.CONFLICT
        );
      }
      if (order.status !== "inService" || !order.serviceStartedAt) {
        throw new AppException(
          "VOICE_SERVICE_NOT_STARTED",
          "Voice access is available after the companion starts the service",
          HttpStatus.CONFLICT
        );
      }
      const activeRefund = await db.refundTransaction.findFirst({
        where: {
          orderId: order.id,
          status: { in: ["pendingReview", "pending", "processing", "success", "failed"] }
        },
        select: { id: true }
      } as any);
      if (activeRefund) {
        throw new AppException(
          "VOICE_REFUND_IN_PROGRESS",
          "Voice access is unavailable while the order is in after-sales handling",
          HttpStatus.CONFLICT
        );
      }

      const now = new Date();
      // Manual start may be allowed shortly before the reserved slot. Match the
      // completion rule: an early start never silently shortens the paid voice
      // duration, while a delayed start still cannot extend the booked window.
      const billableServiceStartAt = new Date(Math.max(
        order.scheduledAt.getTime(),
        order.serviceStartedAt.getTime()
      ));
      const serviceEndsAt = new Date(billableServiceStartAt.getTime() + order.durationMinutes * 60_000);
      await assertCurrentCustomerAdultEligibility(db, order.userId, now, serviceEndsAt);
      await assertCurrentCompanionCommercialEligibility(
        db,
        order.companionId,
        now,
        serviceEndsAt
      );
      const remainingSeconds = Math.floor((serviceEndsAt.getTime() - now.getTime()) / 1_000);
      if (remainingSeconds < MIN_JOINABLE_REMAINING_SECONDS) {
        throw new AppException(
          "VOICE_SERVICE_WINDOW_EXPIRED",
          "The real-time voice service window has ended",
          HttpStatus.CONFLICT
        );
      }

      const participantRole: ParticipantRole = order.userId === userId ? "customer" : "companion";
      const roomId = this.roomIdForOrder(order.id);
      const ttlSeconds = Math.min(runtime.userSigTtlSeconds, remainingSeconds);
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);
      const trtcUserId = this.trtcUserIdForPlatformUser(userId);
      // Do not load the external signing dependency until the caller has proved
      // they are an eligible participant. This keeps a package/provider outage
      // from changing an unauthorized request into a feature-health oracle.
      const signer = this.createSigner(runtime);
      let userSig: string;
      let privateMapKey: string;
      try {
        userSig = signer.genUserSig(trtcUserId, ttlSeconds);
        privateMapKey = signer.genPrivateMapKeyWithStringRoomID(
          trtcUserId,
          ttlSeconds,
          roomId,
          TRTC_AUDIO_ROOM_PRIVILEGES
        );
      } catch {
        // Provider errors can contain implementation details. Do not surface or
        // log any signing material to the client or audit trail.
        throw new AppException(
          "VOICE_SIGNING_UNAVAILABLE",
          "Real-time voice credentials are temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }

      const session = await db.voiceSession.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          roomId,
          provider: "trtc",
          firstAccessedAt: now,
          lastAccessedAt: now,
          accessCount: 1
        },
        update: {
          lastAccessedAt: now,
          accessCount: { increment: 1 }
        },
        select: { roomId: true }
      } as any);

      return {
        order,
        roomId: session.roomId,
        participantRole,
        expiresAt,
        serviceEndsAt,
        trtcUserId,
        userSig,
        privateMapKey
      };
    }, { maxWait: 5_000, timeout: 10_000 });

    await this.audit.record({
      actorId: userId,
      subjectUserIds: [access.order.userId, access.order.companion.ownerUserId]
        .filter((candidate): candidate is string => Boolean(candidate)),
      action: "voice.room_access_granted",
      resourceType: "order",
      resourceId: access.order.id,
      metadata: {
        provider: "trtc",
        roomId: access.roomId,
        participantRole: access.participantRole,
        expiresAt: access.expiresAt.toISOString(),
        serviceEndsAt: access.serviceEndsAt.toISOString(),
        privacyNoticeVersion: runtime.privacyNoticeVersion,
        privacyDisclosureReference: runtime.privacyDisclosureReference,
        recording: "notRecordedByPlatform"
      }
    });

    return {
      provider: "trtc" as const,
      sdkAppId: runtime.sdkAppId,
      roomId: access.roomId,
      userId: access.trtcUserId,
      userSig: access.userSig,
      privateMapKey: access.privateMapKey,
      participantRole: access.participantRole,
      expiresAt: access.expiresAt.toISOString(),
      serviceEndsAt: access.serviceEndsAt.toISOString(),
      participant: access.participantRole === "customer"
        ? { name: access.order.companion.name, initials: access.order.companion.initials }
        : { name: "客户", initials: "客户" }
    };
  }

  private runtimeConfig(): VoiceRuntimeConfig {
    const enabled = this.config.get<boolean>("TRTC_ENABLED", false);
    if (!enabled) {
      throw new AppException(
        "VOICE_FEATURE_DISABLED",
        "Real-time voice is not configured for this environment",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    if (this.config.get<boolean>("TRTC_EMERGENCY_STOP_ENABLED", false)) {
      // The room-control worker remains enabled during a controlled emergency
      // drain, but no process may mint another credential while it is closing
      // already-connected sessions.
      throw new AppException(
        "VOICE_FEATURE_EMERGENCY_STOP",
        "Real-time voice is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const sdkAppId = this.config.get<number>("TRTC_SDK_APP_ID", 0);
    const sdkSecretKey = this.config.get<string>("TRTC_SDK_SECRET_KEY", "");
    const privateMapKeyEnabled = this.config.get<boolean>("TRTC_PRIVATE_MAP_KEY_ENABLED", false);
    const privacyDisclosureApproved = this.config.get<boolean>("TRTC_PRIVACY_DISCLOSURE_APPROVED", false);
    const privacyDisclosureReference = this.config.get<string>("TRTC_PRIVACY_DISCLOSURE_REFERENCE", "");
    const privacyNoticeVersion = this.config.get<string>("LEGAL_CONSENT_VERSION", "");
    const userSigTtlSeconds = this.config.get<number>("TRTC_USER_SIG_TTL_SECONDS", 300);
    if (
      !Number.isSafeInteger(sdkAppId)
      || sdkAppId < 1
      || !sdkSecretKey
      || !privateMapKeyEnabled
      || !privacyDisclosureApproved
      || !privacyDisclosureReference
      || !privacyNoticeVersion
    ) {
      throw new AppException(
        "VOICE_FEATURE_DISABLED",
        "Real-time voice is not configured for this environment",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return {
      sdkAppId,
      sdkSecretKey,
      userSigTtlSeconds,
      privacyNoticeVersion,
      privacyDisclosureReference
    };
  }

  private createSigner(runtime: VoiceRuntimeConfig): TrtcSigner {
    try {
      // This stays dynamic so a deliberately disabled environment can boot
      // safely before its external RTC package and credentials are provisioned.
      // The release checklist requires the declared package to be installed
      // before TRTC_ENABLED may be switched on.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const module = require("tls-sig-api-v2") as TrtcSignerModule;
      if (typeof module?.Api !== "function") throw new Error("Missing TRTC signer API");
      return new module.Api(runtime.sdkAppId, runtime.sdkSecretKey);
    } catch {
      throw new AppException(
        "VOICE_SIGNING_UNAVAILABLE",
        "Real-time voice signing is unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private roomIdForOrder(orderId: string): string {
    return `tt_voice_${orderId.replace(/-/g, "")}`;
  }

  private trtcUserIdForPlatformUser(platformUserId: string): string {
    const opaque = createHash("sha256")
      .update(`talk-and-talk:trtc-user:${platformUserId}`)
      .digest("base64url")
      .slice(0, 24);
    return `tt_${opaque}`;
  }
}
