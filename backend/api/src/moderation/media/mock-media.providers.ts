import { Injectable } from "@nestjs/common";

import {
  MediaAnalysisProvider,
  MediaAnalysisResult,
  MediaAssetReference,
  MediaStorageProvider,
  MediaUploadInstruction
} from "./media-provider.interface";

/**
 * Development/test adapter only. It makes the contract testable without
 * pretending to persist customer media or perform real model inference.
 */
@Injectable()
export class MockMediaStorageProvider implements MediaStorageProvider {
  readonly name = "mock";
  readonly isConfigured = true;

  async createUploadInstruction(input: MediaAssetReference): Promise<MediaUploadInstruction> {
    return {
      url: `mock://media-upload/${encodeURIComponent(input.storageKey)}`,
      method: "PUT",
      headers: { "x-media-asset-id": input.id },
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    };
  }

  async verifyUpload(_input: MediaAssetReference): Promise<boolean> {
    return true;
  }

  async createReadUrl(input: MediaAssetReference): Promise<string> {
    return `mock://media-read/${encodeURIComponent(input.storageKey)}`;
  }

  async delete(_input: MediaAssetReference): Promise<"deleted"> {
    return "deleted";
  }
}

@Injectable()
export class MockMediaAnalysisProvider implements MediaAnalysisProvider {
  readonly name = "mock";
  readonly isConfigured = true;

  async analyzeImage(_input: MediaAssetReference): Promise<MediaAnalysisResult> {
    return { available: true, score: 0.05, reasons: [], categories: ["normal"], provider: this.name, providerVersion: "v1" };
  }

  async transcribeAudio(_input: MediaAssetReference): Promise<MediaAnalysisResult> {
    return { available: true, score: 0.05, reasons: [], categories: ["normal"], extractedText: "", provider: this.name, providerVersion: "v1" };
  }
}
