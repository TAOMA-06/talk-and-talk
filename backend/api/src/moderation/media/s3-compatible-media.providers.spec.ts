import { ConfigService } from "@nestjs/config";

import { S3CompatibleMediaStorageProvider } from "./s3-compatible-media.providers";

describe("S3CompatibleMediaStorageProvider", () => {
  const values: Record<string, string | boolean> = {
    MEDIA_S3_ENDPOINT: "https://cos.example.com",
    MEDIA_S3_REGION: "ap-shanghai",
    MEDIA_S3_BUCKET: "talk-media",
    MEDIA_S3_ACCESS_KEY_ID: "AKID",
    MEDIA_S3_SECRET_ACCESS_KEY: "SECRET",
    MEDIA_S3_FORCE_PATH_STYLE: true
  };
  const config = {
    get: (key: string) => values[key]
  } as ConfigService;
  const provider = new S3CompatibleMediaStorageProvider(config);

  it("is configured only when endpoint, bucket, and credentials exist", () => {
    expect(provider.isConfigured).toBe(true);
    values.MEDIA_S3_SECRET_ACCESS_KEY = "";
    expect(provider.isConfigured).toBe(false);
    values.MEDIA_S3_SECRET_ACCESS_KEY = "SECRET";
  });

  it("creates a SigV4 PUT upload instruction", async () => {
    const instruction = await provider.createUploadInstruction({
      id: "asset-1",
      storageKey: "chat/a1.bin",
      kind: "image",
      mimeType: "image/jpeg",
      sizeBytes: 12,
      sha256: "abc"
    });
    expect(instruction?.method).toBe("PUT");
    expect(instruction?.url).toContain("https://cos.example.com/talk-media/chat/a1.bin");
    expect(instruction?.url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(instruction?.url).toContain("X-Amz-Signature=");
    expect(instruction?.headers["content-type"]).toBe("image/jpeg");
  });

  it("treats missing objects as successful deletes", async () => {
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: false,
      status: 404
    } as any);
    await expect(provider.delete({
      id: "asset-1",
      storageKey: "chat/missing.bin",
      kind: "image",
      mimeType: "image/jpeg",
      sizeBytes: 1,
      sha256: "x"
    })).resolves.toBe("notFound");
    fetchMock.mockRestore();
  });
});
