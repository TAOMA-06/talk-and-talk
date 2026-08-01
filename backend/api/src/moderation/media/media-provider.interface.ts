export const MEDIA_STORAGE_PROVIDER = Symbol("MEDIA_STORAGE_PROVIDER");
export const MEDIA_ANALYSIS_PROVIDER = Symbol("MEDIA_ANALYSIS_PROVIDER");

export type MediaKind = "image" | "audio";

export type MediaUploadInstruction = {
  url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  expiresAt: Date;
};

export type MediaAssetReference = {
  id: string;
  storageKey: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  durationMs?: number | null;
};

export type MediaStorageDeleteResult = "deleted" | "notFound";

export type MediaAnalysisResult = {
  available: boolean;
  score: number;
  reasons: string[];
  categories: string[];
  extractedText?: string;
  provider?: string;
  providerVersion?: string;
};

export interface MediaStorageProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  createUploadInstruction(input: MediaAssetReference): Promise<MediaUploadInstruction | null>;
  verifyUpload(input: MediaAssetReference): Promise<boolean>;
  createReadUrl(input: MediaAssetReference): Promise<string | null>;
  /**
   * Delete must be idempotent. A provider-side missing object is a successful
   * terminal outcome so a worker can safely retry after crashing between the
   * network call and its database finalize step.
   */
  delete(input: MediaAssetReference): Promise<MediaStorageDeleteResult>;
}

export interface MediaAnalysisProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  analyzeImage(input: MediaAssetReference): Promise<MediaAnalysisResult>;
  transcribeAudio(input: MediaAssetReference): Promise<MediaAnalysisResult>;
}
