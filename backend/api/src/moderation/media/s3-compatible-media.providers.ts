import { createHmac, createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  MediaAssetReference,
  MediaStorageDeleteResult,
  MediaStorageProvider,
  MediaUploadInstruction
} from "./media-provider.interface";

type S3CompatibleSettings = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl: string | null;
};

/**
 * Production-shaped object-storage adapter for COS/S3-compatible endpoints.
 * Signing uses SigV4 so no AWS SDK dependency is required. The provider is
 * only considered configured when every credential and bucket setting exists;
 * MediaAssetService still refuses to enable uploads on text_only surfaces.
 */
@Injectable()
export class S3CompatibleMediaStorageProvider implements MediaStorageProvider {
  readonly name = "s3_compatible";

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return this.readSettings() !== null;
  }

  async createUploadInstruction(input: MediaAssetReference): Promise<MediaUploadInstruction | null> {
    const settings = this.readSettings();
    if (!settings) return null;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const url = this.presign("PUT", input.storageKey, settings, 600, input.mimeType);
    return {
      url,
      method: "PUT",
      headers: {
        "content-type": input.mimeType,
        "x-amz-meta-sha256": input.sha256,
        "x-amz-meta-asset-id": input.id
      },
      expiresAt
    };
  }

  async verifyUpload(input: MediaAssetReference): Promise<boolean> {
    const settings = this.readSettings();
    if (!settings) return false;
    const response = await fetch(this.objectUrl(input.storageKey, settings), {
      method: "HEAD",
      signal: AbortSignal.timeout(8_000)
    }).catch(() => null);
    if (!response || !response.ok) return false;
    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > 0 && length !== input.sizeBytes) {
      return false;
    }
    return true;
  }

  async createReadUrl(input: MediaAssetReference): Promise<string | null> {
    const settings = this.readSettings();
    if (!settings) return null;
    if (settings.publicBaseUrl) {
      return `${settings.publicBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.storageKey).replace(/%2F/g, "/")}`;
    }
    return this.presign("GET", input.storageKey, settings, 300);
  }

  async delete(input: MediaAssetReference): Promise<MediaStorageDeleteResult> {
    const settings = this.readSettings();
    if (!settings) return "notFound";
    const response = await fetch(this.presign("DELETE", input.storageKey, settings, 60), {
      method: "DELETE",
      signal: AbortSignal.timeout(8_000)
    }).catch(() => null);
    if (!response) return "notFound";
    if (response.status === 404) return "notFound";
    if (response.ok || response.status === 204) return "deleted";
    return "notFound";
  }

  private readSettings(): S3CompatibleSettings | null {
    const endpoint = this.config.get<string>("MEDIA_S3_ENDPOINT")?.trim() ?? "";
    const region = this.config.get<string>("MEDIA_S3_REGION")?.trim() || "auto";
    const bucket = this.config.get<string>("MEDIA_S3_BUCKET")?.trim() ?? "";
    const accessKeyId = this.config.get<string>("MEDIA_S3_ACCESS_KEY_ID")?.trim() ?? "";
    const secretAccessKey = this.config.get<string>("MEDIA_S3_SECRET_ACCESS_KEY")?.trim() ?? "";
    const forcePathStyle = this.config.get<boolean>("MEDIA_S3_FORCE_PATH_STYLE") !== false;
    const publicBaseUrl = this.config.get<string>("MEDIA_S3_PUBLIC_BASE_URL")?.trim() || null;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      return null;
    }
    if (!/^https:\/\//i.test(endpoint)) {
      return null;
    }
    return { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, publicBaseUrl };
  }

  private objectUrl(key: string, settings: S3CompatibleSettings) {
    const base = settings.endpoint.replace(/\/+$/, "");
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    if (settings.forcePathStyle) {
      return `${base}/${settings.bucket}/${encodedKey}`;
    }
    const host = new URL(base).host;
    return `${new URL(base).protocol}//${settings.bucket}.${host}/${encodedKey}`;
  }

  private presign(
    method: "GET" | "PUT" | "DELETE",
    key: string,
    settings: S3CompatibleSettings,
    expiresSeconds: number,
    contentType?: string
  ) {
    const url = new URL(this.objectUrl(key, settings));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${settings.region}/s3/aws4_request`;
    const signedHeaders = contentType ? "content-type;host" : "host";
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${settings.accessKeyId}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresSeconds),
      "X-Amz-SignedHeaders": signedHeaders
    });
    const canonicalQuery = [...query.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join("&");
    const canonicalHeaders = contentType
      ? `content-type:${contentType}\nhost:${url.host}\n`
      : `host:${url.host}\n`;
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD"
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      createHash("sha256").update(canonicalRequest).digest("hex")
    ].join("\n");
    const signingKey = this.signingKey(settings.secretAccessKey, dateStamp, settings.region);
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    query.set("X-Amz-Signature", signature);
    url.search = query.toString();
    return url.toString();
  }

  private signingKey(secret: string, dateStamp: string, region: string) {
    const kDate = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    return createHmac("sha256", kService).update("aws4_request").digest();
  }
}
