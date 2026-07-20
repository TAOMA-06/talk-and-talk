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
  delete(input: MediaAssetReference): Promise<void>;
}

export interface MediaAnalysisProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  analyzeImage(input: MediaAssetReference): Promise<MediaAnalysisResult>;
  transcribeAudio(input: MediaAssetReference): Promise<MediaAnalysisResult>;
}
