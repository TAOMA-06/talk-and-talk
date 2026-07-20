import { Injectable } from "@nestjs/common";

import {
  MediaAnalysisProvider,
  MediaAnalysisResult,
  MediaAssetReference,
  MediaStorageProvider,
  MediaUploadInstruction
} from "./media-provider.interface";

const unavailable = (provider: string): MediaAnalysisResult => ({
  available: false,
  score: 0.05,
  reasons: [],
  categories: [],
  provider
});

/** Production-safe default: no media can bypass a real provider configuration. */
@Injectable()
export class DisabledMediaStorageProvider implements MediaStorageProvider {
  readonly name = "disabled";
  readonly isConfigured = false;

  async createUploadInstruction(_input: MediaAssetReference): Promise<MediaUploadInstruction | null> {
    return null;
  }

  async verifyUpload(_input: MediaAssetReference): Promise<boolean> {
    return false;
  }

  async createReadUrl(_input: MediaAssetReference): Promise<string | null> {
    return null;
  }

  async delete(_input: MediaAssetReference): Promise<void> {}
}

@Injectable()
export class DisabledMediaAnalysisProvider implements MediaAnalysisProvider {
  readonly name = "disabled";
  readonly isConfigured = false;

  async analyzeImage(_input: MediaAssetReference): Promise<MediaAnalysisResult> {
    return unavailable(this.name);
  }

  async transcribeAudio(_input: MediaAssetReference): Promise<MediaAnalysisResult> {
    return unavailable(this.name);
  }
}
