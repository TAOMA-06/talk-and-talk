import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import { AppException } from "../../common/errors/app.exception";
import {
  FirstReleaseCapability,
  isFirstReleaseCapabilityEnabled
} from "../../config/first-release-capability-matrix";
import { PrismaService } from "../../database/prisma.service";
import {
  MEDIA_ANALYSIS_PROVIDER,
  MEDIA_STORAGE_PROVIDER,
  MediaAnalysisProvider,
  MediaAssetReference,
  MediaKind,
  MediaStorageDeleteResult,
  MediaStorageProvider
} from "./media-provider.interface";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const EVIDENCE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const CONTROLLED_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;
const CONTROLLED_UPLOAD_INSTRUCTION_WINDOW_MS = 15 * 60 * 1000;
const MAX_PENDING_CONTROLLED_UPLOADS_PER_SCOPE = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 60 * 1000;
const MEDIA_EXPIRY_BATCH_SIZE = 20;
const MEDIA_STORAGE_DELETE_CONCURRENCY = 4;
const MEDIA_STORAGE_DELETE_LEASE_MS = 2 * 60_000;
const MEDIA_STORAGE_DELETE_TIMEOUT_MS = 15_000;

type ClaimedMediaAsset = {
  id: string;
  storageKey: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  durationMs: number | null;
  storageDeleteLeaseToken: string;
  storageDeleteAttemptCount: number;
};

type StorageDeleteOutcome = "deleted" | "notFound" | "failed" | "leaseLost";

const ALLOWED_MIME_TYPES: Record<MediaKind, ReadonlySet<string>> = {
  image: new Set(["image/jpeg", "image/png", "image/webp"]),
  audio: new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/amr"])
};

export type ControlledEvidencePurpose =
  | "orderSupportFact"
  | "attendanceDisputeStatement"
  | "companionIncidentReport";

export type ControlledEvidenceScope = {
  supportTicketId?: string;
  attendanceDisputeId?: string;
  companionId?: string;
};

@Injectable()
export class MediaAssetService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    @Inject(MEDIA_ANALYSIS_PROVIDER) private readonly analysis: MediaAnalysisProvider,
    @Optional() private readonly config?: ConfigService
  ) {}

  isFeatureEnabled(): boolean {
    // Retained for existing chat-status and worker callers. New call sites must
    // choose their explicit capability rather than treating media as one switch.
    return this.isChatMediaUploadEnabled();
  }

  isChatMediaUploadEnabled(): boolean {
    return this.isCapabilityEnabled("chatMediaUpload");
  }

  isChatMediaPlaybackEnabled(): boolean {
    return this.isCapabilityEnabled("chatMediaPlayback");
  }

  isCaseEvidenceMediaEnabled(): boolean {
    return this.isCapabilityEnabled("caseEvidenceMedia");
  }

  assertChatMediaUploadEnabled() {
    this.assertCapabilityEnabled("chatMediaUpload");
  }

  assertCaseEvidenceMediaEnabled() {
    this.assertCapabilityEnabled("caseEvidenceMedia");
  }

  async reserve(input: {
    uploaderId: string;
    conversationId: string;
    kind: MediaKind;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    durationMs?: number;
  }) {
    this.assertChatMediaUploadEnabled();
    this.validateInput(input);

    const id = randomUUID();
    const storageKey = `chat/${input.conversationId}/${id}`;
    const expiresAt = new Date(Date.now() + RETENTION_MS);
    const asset = await this.prisma.mediaAsset.create({
      data: {
        id,
        uploaderId: input.uploaderId,
        conversationId: input.conversationId,
        kind: input.kind,
        status: "reserved",
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256.toLowerCase(),
        durationMs: input.durationMs ?? null,
        provider: this.storage.name,
        expiresAt
      }
    } as any);
    const instruction = await this.storage.createUploadInstruction(this.toReference(asset));
    if (!instruction) {
      await this.prisma.mediaAsset.delete({ where: { id: asset.id } } as any);
      throw new AppException(
        "MEDIA_UPLOAD_UNAVAILABLE",
        "Media upload is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    return {
      asset: this.toAssetDto(asset),
      upload: {
        url: instruction.url,
        method: instruction.method,
        headers: instruction.headers,
        expiresAt: instruction.expiresAt.toISOString()
      }
    };
  }

  async reserveControlled(input: {
    uploaderId: string;
    purpose: ControlledEvidencePurpose;
    scope: ControlledEvidenceScope;
    kind: MediaKind;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    durationMs?: number;
  }) {
    this.assertCaseEvidenceMediaEnabled();
    this.validateInput(input);
    const scopeData = this.controlledScopeData(input.purpose, input.scope);
    const id = randomUUID();
    const provisionalUploadExpiry = new Date(Date.now() + CONTROLLED_UPLOAD_INSTRUCTION_WINDOW_MS);
    const expiresAt = new Date(Date.now() + CONTROLLED_UPLOAD_RETENTION_MS);
    const storageKey = `case-evidence/${input.purpose}/${Object.values(scopeData)[0]}/${id}`;

    const asset: any = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`case-evidence:${input.uploaderId}:${input.purpose}:${Object.values(scopeData)[0]}`}))::text AS "lock"
      `;
      const pending = await db.mediaAsset.count({
        where: {
          uploaderId: input.uploaderId,
          purpose: input.purpose,
          ...scopeData,
          controlledCaseAttachment: null,
          status: { in: ["reserved", "scanning", "approved"] },
          expiresAt: { gt: new Date() }
        }
      });
      if (pending >= MAX_PENDING_CONTROLLED_UPLOADS_PER_SCOPE) {
        throw new AppException(
          "CASE_EVIDENCE_PENDING_LIMIT_REACHED",
          "Finish or remove an existing evidence upload before adding another",
          HttpStatus.CONFLICT,
          { limit: MAX_PENDING_CONTROLLED_UPLOADS_PER_SCOPE }
        );
      }
      return db.mediaAsset.create({
        data: {
          id,
          uploaderId: input.uploaderId,
          conversationId: null,
          messageId: null,
          purpose: input.purpose,
          ...scopeData,
          kind: input.kind,
          status: "reserved",
          storageKey,
          mimeType: input.mimeType.toLowerCase(),
          sizeBytes: input.sizeBytes,
          sha256: input.sha256.toLowerCase(),
          durationMs: input.durationMs ?? null,
          provider: this.storage.name,
          uploadExpiresAt: provisionalUploadExpiry,
          expiresAt
        }
      });
    });

    const instruction = await this.storage.createUploadInstruction(this.toReference(asset));
    if (!instruction || instruction.expiresAt.getTime() <= Date.now()) {
      await this.prisma.mediaAsset.delete({ where: { id: asset.id } } as any);
      throw new AppException(
        "MEDIA_UPLOAD_UNAVAILABLE",
        "Media upload is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const updated = await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { uploadExpiresAt: instruction.expiresAt }
    } as any);
    return {
      asset: this.toAssetDto(updated),
      upload: {
        url: instruction.url,
        method: instruction.method,
        headers: instruction.headers,
        expiresAt: instruction.expiresAt.toISOString()
      }
    };
  }

  async complete(assetId: string, uploaderId: string, conversationId: string) {
    this.assertChatMediaUploadEnabled();
    const asset: any = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, uploaderId, conversationId }
    } as any);
    if (!asset) {
      throw new AppException("MEDIA_ASSET_NOT_FOUND", "Media asset was not found", HttpStatus.NOT_FOUND);
    }
    if (asset.status !== "reserved") {
      throw new AppException("MEDIA_ASSET_INVALID_STATE", "Media asset is not awaiting upload", HttpStatus.CONFLICT);
    }
    const verified = await this.storage.verifyUpload(this.toReference(asset));
    if (!verified) {
      throw new AppException(
        "MEDIA_UPLOAD_INCOMPLETE",
        "Media upload could not be verified",
        HttpStatus.CONFLICT
      );
    }
    const updated = await this.prisma.mediaAsset.update({
      where: { id: assetId },
      data: { status: "uploaded", lastError: null, nextAttemptAt: null }
    } as any);
    return { asset: this.toAssetDto(updated) };
  }

  async completeControlled(assetId: string, uploaderId: string) {
    this.assertCaseEvidenceMediaEnabled();
    const asset: any = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        uploaderId,
        purpose: { in: ["orderSupportFact", "attendanceDisputeStatement", "companionIncidentReport"] }
      }
    } as any);
    if (!asset) {
      throw new AppException("CASE_EVIDENCE_NOT_FOUND", "Evidence upload was not found", HttpStatus.NOT_FOUND);
    }
    // Completion is deliberately idempotent. A client that uploaded the bytes
    // but lost the HTTP response can safely resume polling the same asset.
    if (asset.status !== "reserved") return { asset: this.toAssetDto(asset) };
    if (!asset.uploadExpiresAt || asset.uploadExpiresAt.getTime() <= Date.now()) {
      const failed = await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: "failed", lastError: "upload_instruction_expired", nextAttemptAt: null }
      } as any);
      throw new AppException(
        "CASE_EVIDENCE_UPLOAD_EXPIRED",
        "The evidence upload authorization expired; choose the file again",
        HttpStatus.CONFLICT,
        { asset: this.toAssetDto(failed) }
      );
    }
    const verified = await this.storage.verifyUpload(this.toReference(asset));
    if (!verified) {
      throw new AppException(
        "MEDIA_UPLOAD_INCOMPLETE",
        "Media upload could not be verified",
        HttpStatus.CONFLICT
      );
    }
    const transitioned = await this.prisma.mediaAsset.updateMany({
      where: { id: asset.id, uploaderId, status: "reserved" },
      data: {
        status: "scanning",
        retryCount: 0,
        nextAttemptAt: null,
        lastError: null,
        moderationProcessingToken: null,
        moderationProcessingAt: null
      }
    } as any);
    const updated = transitioned.count === 1
      ? await this.prisma.mediaAsset.findUnique({ where: { id: asset.id } } as any)
      : await this.prisma.mediaAsset.findFirst({ where: { id: asset.id, uploaderId } } as any);
    return { asset: this.toAssetDto(updated) };
  }

  async controlledStatus(assetId: string, uploaderId: string) {
    this.assertCaseEvidenceMediaEnabled();
    const asset: any = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        uploaderId,
        purpose: { in: ["orderSupportFact", "attendanceDisputeStatement", "companionIncidentReport"] }
      }
    } as any);
    if (!asset) {
      throw new AppException("CASE_EVIDENCE_NOT_FOUND", "Evidence upload was not found", HttpStatus.NOT_FOUND);
    }
    return { asset: this.toAssetDto(asset) };
  }

  async approvedReadUrl(asset: any): Promise<string> {
    this.assertCaseEvidenceMediaEnabled();
    if (
      asset?.status !== "approved"
      || asset.storageDeletedAt
      || !asset.expiresAt
      || asset.expiresAt.getTime() <= Date.now()
    ) {
      throw new AppException(
        "CASE_EVIDENCE_UNAVAILABLE",
        "Evidence is not available for viewing",
        HttpStatus.GONE
      );
    }
    const url = await this.storage.createReadUrl(this.toReference(asset));
    if (!url) {
      throw new AppException(
        "CASE_EVIDENCE_READ_UNAVAILABLE",
        "Evidence is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return url;
  }

  controlledAttachmentDto(attachment: any) {
    this.assertCaseEvidenceMediaEnabled();
    const asset = attachment.mediaAsset;
    return {
      id: attachment.id,
      kind: asset.kind,
      status: asset.status,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs ?? null,
      expiresAt: asset.expiresAt?.toISOString?.() ?? null
    };
  }

  async bindUploadedAssets(input: {
    assetIds: string[];
    uploaderId: string;
    conversationId: string;
    messageId: string;
    db?: { mediaAsset: PrismaService["mediaAsset"] };
  }) {
    if (!input.assetIds.length) return [];
    this.assertChatMediaUploadEnabled();
    const client = input.db ?? this.prisma;
    const assets: any[] = await client.mediaAsset.findMany({
      where: {
        id: { in: input.assetIds },
        uploaderId: input.uploaderId,
        conversationId: input.conversationId,
        status: "uploaded",
        messageId: null
      }
    } as any);
    if (assets.length !== input.assetIds.length) {
      throw new AppException(
        "MEDIA_ASSET_INVALID",
        "Every attachment must be uploaded and belong to this conversation",
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }
    await client.mediaAsset.updateMany({
      where: { id: { in: input.assetIds } },
      data: { messageId: input.messageId, status: "scanning" }
    } as any);
    return assets;
  }

  /**
   * A case converts attached media from ordinary 30-day chat retention to the
   * 180-day evidence retention period. Real storage adapters are responsible
   * for keeping this evidence in encrypted storage under their own key policy.
   */
  async preserveEvidenceForMessage(
    messageId: string,
    db?: { mediaAsset: PrismaService["mediaAsset"] }
  ) {
    const client = db ?? this.prisma;
    const expiresAt = new Date(Date.now() + EVIDENCE_RETENTION_MS);
    return client.mediaAsset.updateMany({
      where: { messageId, expiresAt: { lt: expiresAt } },
      data: { expiresAt }
    } as any);
  }

  async attachmentsForMessage(messageId: string, includeReadUrl = true) {
    // Historical rows may outlive a release-surface change. Returning an empty
    // attachment collection before querying prevents both metadata disclosure
    // and signed playback URL issuance in text-only production candidates.
    if (!this.isChatMediaPlaybackEnabled()) return [];
    const assets: any[] = await this.prisma.mediaAsset.findMany({
      where: { messageId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    } as any);
    return Promise.all(assets.map((asset) => this.toAttachmentDto(asset, includeReadUrl)));
  }

  async toAttachmentDto(asset: any, includeReadUrl = true) {
    const readable = asset.status === "approved";
    const url = includeReadUrl && this.isChatMediaPlaybackEnabled() && readable && asset.status !== "expired"
      ? await this.storage.createReadUrl(this.toReference(asset))
      : null;
    return {
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs ?? null,
      url,
      expiresAt: asset.expiresAt?.toISOString?.() ?? null
    };
  }

  async expireDueAssets(now = new Date()) {
    const assets = await this.claimDueStorageDeletes(now, MEDIA_EXPIRY_BATCH_SIZE);
    const outcomes = await this.mapWithConcurrency(
      assets,
      MEDIA_STORAGE_DELETE_CONCURRENCY,
      (asset) => this.processStorageDeleteClaim(asset)
    );
    const count = (outcome: StorageDeleteOutcome) => outcomes.filter((item) => item === outcome).length;
    return {
      processed: assets.length,
      expired: count("deleted") + count("notFound"),
      notFound: count("notFound"),
      failed: count("failed"),
      leaseLost: count("leaseLost"),
      batchSize: MEDIA_EXPIRY_BATCH_SIZE,
      // A full claim is an inexpensive, race-safe continuation hint. Rows
      // leased by another replica are intentionally not treated as our work.
      hasMore: assets.length === MEDIA_EXPIRY_BATCH_SIZE
    };
  }

  private async claimDueStorageDeletes(now: Date, limit: number): Promise<ClaimedMediaAsset[]> {
    return this.prisma.$queryRawUnsafe<ClaimedMediaAsset[]>(
      `WITH candidates AS MATERIALIZED (
         SELECT asset."id"
         FROM "MediaAsset" AS asset
         WHERE asset."expiresAt" IS NOT NULL
           AND asset."expiresAt" <= $1
           AND asset."status" <> 'expired'
           AND asset."storageDeletedAt" IS NULL
           AND (
             asset."storageDeleteNextAttemptAt" IS NULL
             OR asset."storageDeleteNextAttemptAt" <= CURRENT_TIMESTAMP
           )
           AND (
             asset."storageDeleteLeaseExpiresAt" IS NULL
             OR asset."storageDeleteLeaseExpiresAt" <= CURRENT_TIMESTAMP
           )
         ORDER BY asset."expiresAt", asset."id"
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       ), leased AS (
         UPDATE "MediaAsset" AS asset
         SET
           "storageDeleteRequestedAt" = COALESCE(asset."storageDeleteRequestedAt", CURRENT_TIMESTAMP),
           "storageDeleteLeaseToken" = md5(random()::TEXT || clock_timestamp()::TEXT || asset."id"),
           "storageDeleteLeaseExpiresAt" = CURRENT_TIMESTAMP + ($3::BIGINT * INTERVAL '1 millisecond'),
           "storageDeleteAttemptCount" = asset."storageDeleteAttemptCount" + 1,
           "updatedAt" = CURRENT_TIMESTAMP
         FROM candidates
         WHERE asset."id" = candidates."id"
         RETURNING
           asset."id", asset."storageKey", asset."kind", asset."mimeType",
           asset."sizeBytes", asset."sha256", asset."durationMs",
           asset."storageDeleteLeaseToken", asset."storageDeleteAttemptCount",
           asset."expiresAt"
       )
       SELECT
         "id", "storageKey", "kind", "mimeType", "sizeBytes", "sha256",
         "durationMs", "storageDeleteLeaseToken", "storageDeleteAttemptCount"
       FROM leased
       ORDER BY "expiresAt", "id"`,
      now,
      limit,
      MEDIA_STORAGE_DELETE_LEASE_MS
    );
  }

  private async processStorageDeleteClaim(asset: ClaimedMediaAsset): Promise<StorageDeleteOutcome> {
    let result: MediaStorageDeleteResult;
    try {
      const providerResult = await this.deleteFromStorageWithTimeout(asset);
      result = providerResult === "notFound" ? "notFound" : "deleted";
    } catch (error) {
      if (this.isStorageNotFound(error)) {
        result = "notFound";
      } else {
        const retryDelayMs = Math.min(
          24 * 60 * 60_000,
          5 * 60_000 * 2 ** Math.min(Math.max(0, asset.storageDeleteAttemptCount - 1), 8)
        );
        const retryAt = new Date(Date.now() + retryDelayMs);
        const failed = await this.prisma.$executeRawUnsafe(
          `UPDATE "MediaAsset"
           SET
             "storageDeleteNextAttemptAt" = $1,
             "storageDeleteLastErrorCode" = $2,
             "storageDeleteLeaseToken" = NULL,
             "storageDeleteLeaseExpiresAt" = NULL,
             "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $3
             AND "storageDeleteLeaseToken" = $4
             AND "storageDeletedAt" IS NULL`,
          retryAt,
          this.storageDeleteErrorCode(error),
          asset.id,
          asset.storageDeleteLeaseToken
        );
        return Number(failed) === 1 ? "failed" : "leaseLost";
      }
    }

    const deletedAt = new Date();
    const finalized = await this.prisma.$executeRawUnsafe(
      `UPDATE "MediaAsset"
       SET
         "status" = 'expired',
         "storageDeletedAt" = $1,
         "storageDeleteNextAttemptAt" = NULL,
         "storageDeleteLastErrorCode" = NULL,
         "storageDeleteLeaseToken" = NULL,
         "storageDeleteLeaseExpiresAt" = NULL,
         "extractedText" = NULL,
         "analysis" = NULL,
         "lastError" = NULL,
         "nextAttemptAt" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $2
         AND "storageDeleteLeaseToken" = $3
         AND "storageDeletedAt" IS NULL`,
      deletedAt,
      asset.id,
      asset.storageDeleteLeaseToken
    );
    if (Number(finalized) !== 1) return "leaseLost";
    return result;
  }

  private async deleteFromStorageWithTimeout(asset: ClaimedMediaAsset): Promise<MediaStorageDeleteResult> {
    let timeout: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        this.storage.delete(this.toReference(asset)),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            const error = new Error("Media storage delete timed out");
            error.name = "MediaStorageDeleteTimeout";
            reject(error);
          }, MEDIA_STORAGE_DELETE_TIMEOUT_MS);
          timeout.unref?.();
        })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private isStorageNotFound(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const item = error as {
      code?: unknown;
      name?: unknown;
      status?: unknown;
      statusCode?: unknown;
      $metadata?: { httpStatusCode?: unknown };
    };
    const knownCodes = new Set(["NotFound", "NoSuchKey", "BlobNotFound", "ObjectNotFound"]);
    return item.status === 404
      || item.statusCode === 404
      || item.$metadata?.httpStatusCode === 404
      || [item.code, item.name].some((value) => knownCodes.has(String(value ?? "")));
  }

  private storageDeleteErrorCode(error: unknown): string {
    return error instanceof Error && error.name === "MediaStorageDeleteTimeout"
      ? "media_storage_delete_timeout"
      : "media_storage_delete_failed";
  }

  private async mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    work: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await work(items[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return results;
  }

  toReference(asset: any): MediaAssetReference {
    return {
      id: asset.id,
      storageKey: asset.storageKey,
      kind: asset.kind,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      durationMs: asset.durationMs ?? null
    };
  }

  private isCapabilityEnabled(capability: FirstReleaseCapability): boolean {
    return isFirstReleaseCapabilityEnabled(capability, this.config)
      && this.storage.isConfigured
      && this.analysis.isConfigured;
  }

  private assertCapabilityEnabled(capability: FirstReleaseCapability) {
    if (!this.isCapabilityEnabled(capability)) {
      throw new AppException(
        "MEDIA_FEATURE_DISABLED",
        "Media is disabled for this release surface",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private validateInput(input: {
    kind: MediaKind;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    durationMs?: number;
  }) {
    if (!ALLOWED_MIME_TYPES[input.kind].has(input.mimeType.toLowerCase())) {
      throw new AppException("MEDIA_TYPE_UNSUPPORTED", "Unsupported media type", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const maxBytes = input.kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > maxBytes) {
      throw new AppException("MEDIA_SIZE_INVALID", "Media size is outside allowed limits", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (!/^[a-fA-F0-9]{64}$/.test(input.sha256)) {
      throw new AppException("MEDIA_HASH_INVALID", "A SHA-256 digest is required", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (input.kind === "audio") {
      if (!Number.isSafeInteger(input.durationMs) || input.durationMs! < 1 || input.durationMs! > MAX_AUDIO_DURATION_MS) {
        throw new AppException("MEDIA_DURATION_INVALID", "Audio messages must be 60 seconds or shorter", HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }
  }

  private controlledScopeData(
    purpose: ControlledEvidencePurpose,
    scope: ControlledEvidenceScope
  ): { supportTicketId?: string; attendanceDisputeId?: string; companionId?: string } {
    const values = [scope.supportTicketId, scope.attendanceDisputeId, scope.companionId]
      .filter((value): value is string => Boolean(value));
    const expected = purpose === "orderSupportFact"
      ? scope.supportTicketId
      : purpose === "attendanceDisputeStatement"
        ? scope.attendanceDisputeId
        : scope.companionId;
    if (values.length !== 1 || !expected) {
      throw new AppException(
        "CASE_EVIDENCE_SCOPE_INVALID",
        "Evidence upload scope is invalid",
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }
    return purpose === "orderSupportFact"
      ? { supportTicketId: expected }
      : purpose === "attendanceDisputeStatement"
        ? { attendanceDisputeId: expected }
        : { companionId: expected };
  }

  private toAssetDto(asset: any) {
    return {
      id: asset.id,
      purpose: asset.purpose ?? "chatMessage",
      kind: asset.kind,
      status: asset.status,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs ?? null,
      expiresAt: asset.expiresAt?.toISOString?.() ?? null
    };
  }
}
