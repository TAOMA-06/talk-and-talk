import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { AppException } from "../../common/errors/app.exception";
import { PrismaService } from "../../database/prisma.service";
import {
  MEDIA_ANALYSIS_PROVIDER,
  MEDIA_STORAGE_PROVIDER,
  MediaAnalysisProvider,
  MediaAssetReference,
  MediaKind,
  MediaStorageProvider
} from "./media-provider.interface";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const EVIDENCE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 60 * 1000;

const ALLOWED_MIME_TYPES: Record<MediaKind, ReadonlySet<string>> = {
  image: new Set(["image/jpeg", "image/png", "image/webp"]),
  audio: new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/amr"])
};

@Injectable()
export class MediaAssetService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    @Inject(MEDIA_ANALYSIS_PROVIDER) private readonly analysis: MediaAnalysisProvider
  ) {}

  isFeatureEnabled(): boolean {
    return this.storage.isConfigured && this.analysis.isConfigured;
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
    this.assertEnabled();
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

  async complete(assetId: string, uploaderId: string, conversationId: string) {
    this.assertEnabled();
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

  async bindUploadedAssets(input: {
    assetIds: string[];
    uploaderId: string;
    conversationId: string;
    messageId: string;
    db?: { mediaAsset: PrismaService["mediaAsset"] };
  }) {
    if (!input.assetIds.length) return [];
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
    const assets: any[] = await this.prisma.mediaAsset.findMany({
      where: { messageId },
      orderBy: { createdAt: "asc" }
    } as any);
    return Promise.all(assets.map((asset) => this.toAttachmentDto(asset, includeReadUrl)));
  }

  async toAttachmentDto(asset: any, includeReadUrl = true) {
    const readable = ["approved", "blocked", "expired"].includes(asset.status);
    const url = includeReadUrl && readable && asset.status !== "expired"
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
    const assets: any[] = await this.prisma.mediaAsset.findMany({
      where: { expiresAt: { lte: now }, status: { not: "expired" } },
      take: 100
    } as any);
    for (const asset of assets) {
      await this.storage.delete(this.toReference(asset)).catch(() => undefined);
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: "expired", extractedText: null, analysis: null }
      } as any);
    }
    return assets.length;
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

  private assertEnabled() {
    if (!this.isFeatureEnabled()) {
      throw new AppException(
        "MEDIA_FEATURE_DISABLED",
        "Image and audio messaging is not configured for this environment",
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

  private toAssetDto(asset: any) {
    return {
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs ?? null,
      expiresAt: asset.expiresAt?.toISOString?.() ?? null
    };
  }
}
