import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";

const ALLOWED_EXPORT_CONTENT_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/zip",
  "application/octet-stream"
]);

export type DeliveredDataExport = {
  bytes: Buffer;
  contentType: string;
  filename: string;
};

/**
 * Proxies a completed export from the private evidence vault to its owner.
 *
 * The vault object reference and provider credential never reach the client.
 * Fetches reject redirects and require a declared, bounded byte length so a
 * compromised provider cannot turn this API into an SSRF or unbounded-memory
 * path.
 */
@Injectable()
export class DataExportDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService
  ) {}

  async deliver(userId: string, requestId: string): Promise<DeliveredDataExport> {
    const request = await this.prisma.dataRightsRequest.findFirst({
      where: { id: requestId, userId },
      select: {
        id: true,
        type: true,
        status: true,
        resolutionEvidenceReference: true
      }
    });
    if (!request) {
      throw new AppException(
        "DATA_EXPORT_NOT_FOUND",
        "Data export request not found",
        HttpStatus.NOT_FOUND
      );
    }
    if (
      request.type !== "export"
      || request.status !== "completed"
      || !request.resolutionEvidenceReference
    ) {
      throw new AppException(
        "DATA_EXPORT_NOT_READY",
        "The completed data export is not ready for delivery",
        HttpStatus.CONFLICT
      );
    }

    const baseUrl = this.config.get<string>("DATA_EXPORT_DELIVERY_BASE_URL")?.trim();
    const apiKey = this.config.get<string>("DATA_EXPORT_DELIVERY_API_KEY")?.trim();
    if (!baseUrl || !apiKey) {
      throw new AppException(
        "DATA_EXPORT_DELIVERY_UNAVAILABLE",
        "Secure data-export delivery is not configured",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const timeoutMs = this.config.getOrThrow<number>("DATA_EXPORT_DELIVERY_TIMEOUT_MS");
    const maxBytes = this.config.getOrThrow<number>("DATA_EXPORT_MAX_BYTES");
    const endpoint = new URL(
      `v1/exports/${encodeURIComponent(request.resolutionEvidenceReference)}`,
      baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
    );
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs);
    let upstream: Response;
    try {
      upstream = await fetch(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json, application/pdf, application/zip, application/octet-stream",
          Authorization: `Bearer ${apiKey}`
        },
        redirect: "error",
        signal: abort.signal
      });
    } catch {
      clearTimeout(timeout);
      throw new AppException(
        "DATA_EXPORT_PROVIDER_UNAVAILABLE",
        "The secure data-export provider is unavailable",
        HttpStatus.BAD_GATEWAY
      );
    }

    let contentType: string;
    let bytes: Buffer;
    try {
      if (!upstream.ok) {
        throw new AppException(
          "DATA_EXPORT_PROVIDER_REJECTED",
          "The secure data-export provider rejected the delivery request",
          HttpStatus.BAD_GATEWAY
        );
      }
      const declaredLength = Number(upstream.headers.get("content-length"));
      if (
        !Number.isSafeInteger(declaredLength)
        || declaredLength < 1
        || declaredLength > maxBytes
      ) {
        throw new AppException(
          "DATA_EXPORT_SIZE_INVALID",
          "The data-export provider returned an invalid payload size",
          HttpStatus.BAD_GATEWAY
        );
      }
      contentType = (upstream.headers.get("content-type") || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!ALLOWED_EXPORT_CONTENT_TYPES.has(contentType)) {
        throw new AppException(
          "DATA_EXPORT_CONTENT_TYPE_INVALID",
          "The data-export provider returned an unsupported content type",
          HttpStatus.BAD_GATEWAY
        );
      }
      bytes = await this.readBoundedBody(upstream, declaredLength, maxBytes);
    } finally {
      clearTimeout(timeout);
    }

    await this.audit.record({
      actorId: userId,
      action: "account.data_export_delivered",
      resourceType: "dataRightsRequest",
      resourceId: request.id,
      metadata: {
        contentType,
        sizeBytes: bytes.length
      }
    });

    return {
      bytes,
      contentType,
      filename: `talk-and-talk-data-export-${request.id}.${
        contentType === "application/zip"
          ? "zip"
          : contentType === "application/pdf"
            ? "pdf"
            : "json"
      }`
    };
  }

  private async readBoundedBody(
    upstream: Response,
    declaredLength: number,
    maxBytes: number
  ): Promise<Buffer> {
    if (!upstream.body) {
      throw new AppException(
        "DATA_EXPORT_BODY_MISSING",
        "The data-export provider returned no payload body",
        HttpStatus.BAD_GATEWAY
      );
    }
    const reader = upstream.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > declaredLength || total > maxBytes) {
          await reader.cancel();
          throw new AppException(
            "DATA_EXPORT_SIZE_MISMATCH",
            "The data-export payload exceeded its declared size",
            HttpStatus.BAD_GATEWAY
          );
        }
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        "DATA_EXPORT_PROVIDER_UNAVAILABLE",
        "The secure data-export provider stream was interrupted",
        HttpStatus.BAD_GATEWAY
      );
    }
    if (total !== declaredLength) {
      throw new AppException(
        "DATA_EXPORT_SIZE_MISMATCH",
        "The data-export payload did not match its declared size",
        HttpStatus.BAD_GATEWAY
      );
    }
    return Buffer.concat(chunks, total);
  }
}
