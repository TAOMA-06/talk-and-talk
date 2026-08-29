import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import { AppException } from "../common/errors/app.exception";
import { isFirstReleaseCapabilityEnabled } from "../config/first-release-capability-matrix";
import { PrismaService } from "../database/prisma.service";
import {
  MEDIA_ANALYSIS_PROVIDER,
  MEDIA_STORAGE_PROVIDER,
  MediaAnalysisProvider,
  MediaAssetReference,
  MediaStorageProvider
} from "../moderation/media/media-provider.interface";
import { RuleEngine } from "../moderation/rule-engine";
import { ReserveCompanionProfileMediaDto } from "./dto/reserve-companion-profile-media.dto";

export type CompanionProfileMediaSlot = "avatar" | "cover";

const PROFILE_UPLOAD_WINDOW_MS = 15 * 60 * 1000;
const PROFILE_REVIEW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_MEDIA_LIMITS: Record<CompanionProfileMediaSlot, number> = {
  avatar: 2 * 1024 * 1024,
  cover: 4 * 1024 * 1024
};

@Injectable()
export class CompanionProfileMediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    @Inject(MEDIA_ANALYSIS_PROVIDER) private readonly analysis: MediaAnalysisProvider,
    private readonly ruleEngine: RuleEngine,
    @Optional() private readonly config?: ConfigService
  ) {}

  async reserve(userId: string, slotValue: string, dto: ReserveCompanionProfileMediaDto) {
    this.assertEnabled();
    const slot = this.slot(slotValue);
    this.validateInput(slot, dto);
    const companion = await this.ownedCompanion(userId);
    const id = randomUUID();
    const provisionalUploadExpiry = new Date(Date.now() + PROFILE_UPLOAD_WINDOW_MS);
    const asset: any = await this.prisma.mediaAsset.create({
      data: {
        id,
        uploaderId: userId,
        purpose: this.purpose(slot),
        profileCompanionId: companion.id,
        kind: "image",
        status: "reserved",
        storageKey: `profile-media/${companion.id}/${slot}/${id}`,
        mimeType: dto.mimeType.toLowerCase(),
        sizeBytes: dto.sizeBytes,
        sha256: dto.sha256.toLowerCase(),
        provider: this.storage.name,
        uploadExpiresAt: provisionalUploadExpiry,
        // Abandoned reservations must become eligible for the existing bounded
        // storage-deletion worker. Approved media clears this deadline below.
        expiresAt: provisionalUploadExpiry
      }
    } as any);
    const instruction = await this.storage.createUploadInstruction(this.reference(asset));
    if (!instruction || instruction.expiresAt.getTime() <= Date.now()) {
      await this.prisma.mediaAsset.delete({ where: { id: asset.id } } as any);
      throw new AppException(
        "PROFILE_MEDIA_UPLOAD_UNAVAILABLE",
        "Profile image upload is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const updated = await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { uploadExpiresAt: instruction.expiresAt, expiresAt: instruction.expiresAt }
    } as any);
    return {
      asset: this.dto(updated, slot, false),
      upload: {
        url: instruction.url,
        method: instruction.method,
        headers: instruction.headers,
        expiresAt: instruction.expiresAt.toISOString()
      }
    };
  }

  async complete(userId: string, slotValue: string, assetId: string) {
    this.assertEnabled();
    const slot = this.slot(slotValue);
    const companion = await this.ownedCompanion(userId);
    const asset: any = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        uploaderId: userId,
        profileCompanionId: companion.id,
        purpose: this.purpose(slot)
      }
    } as any);
    if (!asset) {
      throw new AppException("PROFILE_MEDIA_NOT_FOUND", "Profile image upload was not found", HttpStatus.NOT_FOUND);
    }
    if (asset.status !== "reserved" && asset.status !== "scanning") {
      return { asset: this.dto(asset, slot, this.isAttached(companion, slot, asset.id)) };
    }
    if (asset.status === "reserved" && (!asset.uploadExpiresAt || asset.uploadExpiresAt.getTime() <= Date.now())) {
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: "failed", lastError: "upload_instruction_expired", expiresAt: new Date() }
      } as any);
      throw new AppException(
        "PROFILE_MEDIA_UPLOAD_EXPIRED",
        "The profile image upload authorization expired; choose the image again",
        HttpStatus.CONFLICT
      );
    }
    if (asset.status === "reserved" && !await this.storage.verifyUpload(this.reference(asset))) {
      throw new AppException(
        "PROFILE_MEDIA_UPLOAD_INCOMPLETE",
        "Profile image upload could not be verified",
        HttpStatus.CONFLICT
      );
    }

    if (asset.status === "reserved") {
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: "scanning", lastError: null }
      } as any);
    }
    const result = await this.analysis.analyzeImage(this.reference(asset)).catch((error) => ({
      available: false,
      score: 0.55,
      reasons: [error instanceof Error ? error.name : "profile_media_analysis_failed"],
      categories: [],
      provider: this.analysis.name,
      providerVersion: undefined,
      extractedText: undefined
    }));
    const decision = result.available ? this.ruleEngine.decisionFor(result.score) : "review";
    const status = decision === "allow" ? "approved" : decision === "block" ? "blocked" : "reviewRequired";
    const reviewExpiry = status === "approved" ? null : new Date(Date.now() + PROFILE_REVIEW_RETENTION_MS);

    const published = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const current = await db.companionProfile.findFirst({
        where: { id: companion.id, ownerUserId: userId },
        select: { avatarAssetId: true, coverAssetId: true }
      });
      if (!current) {
        throw new AppException("COMPANION_PROFILE_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
      }
      await db.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status,
          analysis: {
            score: result.score,
            reasons: result.reasons,
            categories: result.categories
          },
          extractedText: result.extractedText ?? null,
          provider: result.provider ?? this.analysis.name,
          providerVersion: result.providerVersion ?? null,
          expiresAt: reviewExpiry,
          retryCount: 0,
          nextAttemptAt: null,
          lastError: result.available ? null : "profile_media_moderation_unavailable"
        }
      });
      if (status !== "approved") return false;
      const field = slot === "avatar" ? "avatarAssetId" : "coverAssetId";
      const previousId = current[field];
      await db.companionProfile.update({
        where: { id: companion.id },
        data: { [field]: asset.id }
      });
      if (previousId && previousId !== asset.id) {
        await db.mediaAsset.update({
          where: { id: previousId },
          data: { expiresAt: new Date(), storageDeleteNextAttemptAt: new Date() }
        });
      }
      return true;
    });
    const updated: any = await this.prisma.mediaAsset.findUnique({ where: { id: asset.id } } as any);
    return { asset: this.dto(updated ?? { ...asset, status }, slot, published) };
  }

  async status(userId: string, slotValue: string, assetId: string) {
    this.assertEnabled();
    const slot = this.slot(slotValue);
    const companion = await this.ownedCompanion(userId);
    const asset: any = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        uploaderId: userId,
        profileCompanionId: companion.id,
        purpose: this.purpose(slot)
      }
    } as any);
    if (!asset) {
      throw new AppException("PROFILE_MEDIA_NOT_FOUND", "Profile image upload was not found", HttpStatus.NOT_FOUND);
    }
    return { asset: this.dto(asset, slot, this.isAttached(companion, slot, asset.id)) };
  }

  async remove(userId: string, slotValue: string) {
    const slot = this.slot(slotValue);
    const companion = await this.ownedCompanion(userId);
    const field = slot === "avatar" ? "avatarAssetId" : "coverAssetId";
    const assetId = companion[field];
    if (!assetId) return { removed: false, slot };
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.companionProfile.update({ where: { id: companion.id }, data: { [field]: null } });
      await db.mediaAsset.update({
        where: { id: assetId },
        data: { expiresAt: new Date(), storageDeleteNextAttemptAt: new Date() }
      });
    });
    return { removed: true, slot };
  }

  async publicReadUrl(companionId: string, slotValue: string) {
    this.assertEnabled();
    const slot = this.slot(slotValue);
    const select = slot === "avatar"
      ? { avatarAsset: true }
      : { coverAsset: true };
    const companion: any = await this.prisma.companionProfile.findFirst({
      where: {
        id: companionId,
        isPublished: true,
        isVerified: true,
        ownerUserId: { not: null },
        owner: { accountStatus: "active", profile: { isVerified: true } },
        commercialProfile: {
          status: "verified",
          adultEligibilityVerdict: "adult",
          adultEligibilityValidUntil: { gt: new Date() }
        }
      },
      select
    } as any);
    const asset = slot === "avatar" ? companion?.avatarAsset : companion?.coverAsset;
    if (
      !asset
      || asset.status !== "approved"
      || asset.storageDeletedAt
      || (asset.expiresAt && asset.expiresAt.getTime() <= Date.now())
    ) {
      throw new AppException("PROFILE_MEDIA_NOT_FOUND", "Profile image was not found", HttpStatus.NOT_FOUND);
    }
    const url = await this.storage.createReadUrl(this.reference(asset));
    if (!url) {
      throw new AppException(
        "PROFILE_MEDIA_READ_UNAVAILABLE",
        "Profile image is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return url;
  }

  private async ownedCompanion(userId: string): Promise<any> {
    const companion: any = await this.prisma.companionProfile.findUnique({
      where: { ownerUserId: userId },
      select: { id: true, ownerUserId: true, avatarAssetId: true, coverAssetId: true }
    } as any);
    if (!companion) {
      throw new AppException("COMPANION_PROFILE_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
    }
    return companion;
  }

  private assertEnabled() {
    if (
      !isFirstReleaseCapabilityEnabled("companionProfileMedia", this.config)
      || !this.storage.isConfigured
      || !this.analysis.isConfigured
    ) {
      throw new AppException(
        "PROFILE_MEDIA_DISABLED",
        "Companion profile images are disabled for this release surface",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private slot(value: string): CompanionProfileMediaSlot {
    if (value !== "avatar" && value !== "cover") {
      throw new AppException("PROFILE_MEDIA_SLOT_INVALID", "Profile image slot is invalid", HttpStatus.BAD_REQUEST);
    }
    return value;
  }

  private purpose(slot: CompanionProfileMediaSlot): "companionAvatar" | "companionCover" {
    return slot === "avatar" ? "companionAvatar" : "companionCover";
  }

  private validateInput(slot: CompanionProfileMediaSlot, dto: ReserveCompanionProfileMediaDto) {
    if (!/^image\/(?:jpeg|png|webp)$/i.test(dto.mimeType)) {
      throw new AppException("PROFILE_MEDIA_TYPE_UNSUPPORTED", "Profile image type is unsupported", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (!Number.isSafeInteger(dto.sizeBytes) || dto.sizeBytes < 1 || dto.sizeBytes > PROFILE_MEDIA_LIMITS[slot]) {
      throw new AppException(
        "PROFILE_MEDIA_SIZE_INVALID",
        `Profile ${slot} image is outside the allowed size limit`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        { maxBytes: PROFILE_MEDIA_LIMITS[slot] }
      );
    }
    if (!/^[a-fA-F0-9]{64}$/.test(dto.sha256)) {
      throw new AppException("PROFILE_MEDIA_HASH_INVALID", "A SHA-256 digest is required", HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  private isAttached(companion: any, slot: CompanionProfileMediaSlot, assetId: string) {
    return (slot === "avatar" ? companion.avatarAssetId : companion.coverAssetId) === assetId;
  }

  private reference(asset: any): MediaAssetReference {
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

  private dto(asset: any, slot: CompanionProfileMediaSlot, published: boolean) {
    return {
      id: asset.id,
      slot,
      status: asset.status,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      published,
      uploadExpiresAt: asset.uploadExpiresAt?.toISOString?.() ?? null,
      createdAt: asset.createdAt?.toISOString?.() ?? null,
      updatedAt: asset.updatedAt?.toISOString?.() ?? null
    };
  }
}
