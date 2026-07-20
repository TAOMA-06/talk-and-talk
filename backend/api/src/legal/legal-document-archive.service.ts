import { createHash } from "node:crypto";

import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";

export type LegalDocumentType = "terms" | "privacy" | "platformRules";

/**
 * Persists an immutable copy of every public legal document before it is
 * served. Reusing a version with different content fails closed, so a deploy
 * cannot silently rewrite the text referenced by a consent receipt.
 */
@Injectable()
export class LegalDocumentArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSnapshot(documentType: LegalDocumentType, version: string, html: string) {
    const contentHash = createHash("sha256").update(html, "utf8").digest("hex");
    const existing = await this.prisma.legalDocumentVersion.findUnique({
      where: { documentType_version: { documentType, version } }
    } as any);
    if (existing) {
      this.assertSameContent(existing, contentHash, documentType, version);
      return existing;
    }

    try {
      return await this.prisma.legalDocumentVersion.create({
        data: { documentType, version, contentHash, html }
      } as any);
    } catch {
      // Concurrent requests may both see no snapshot. Re-read the unique row;
      // only the identical document may proceed.
      const raced = await this.prisma.legalDocumentVersion.findUnique({
        where: { documentType_version: { documentType, version } }
      } as any);
      if (!raced) throw new InternalServerErrorException("Unable to publish legal document snapshot");
      this.assertSameContent(raced, contentHash, documentType, version);
      return raced;
    }
  }

  async getSnapshot(documentType: LegalDocumentType, version: string) {
    const snapshot = await this.prisma.legalDocumentVersion.findUnique({
      where: { documentType_version: { documentType, version } }
    } as any);
    if (!snapshot) {
      throw new NotFoundException("Legal document version not found");
    }
    return snapshot;
  }

  async assertVersionPublished(version: string, documentTypes: LegalDocumentType[] = ["terms", "privacy"]) {
    const snapshots = await this.prisma.legalDocumentVersion.findMany({
      where: { version, documentType: { in: documentTypes } },
      select: { documentType: true }
    } as any);
    const published = new Set(snapshots.map((snapshot: any) => snapshot.documentType));
    const missing = documentTypes.filter((documentType) => !published.has(documentType));
    if (missing.length > 0) {
      throw new InternalServerErrorException(
        `Current legal document snapshots are not published: ${missing.join(", ")}`
      );
    }
  }

  private assertSameContent(snapshot: any, contentHash: string, documentType: LegalDocumentType, version: string) {
    if (snapshot.contentHash !== contentHash) {
      throw new InternalServerErrorException(
        `Legal document ${documentType}@${version} changed without a version bump`
      );
    }
  }
}
