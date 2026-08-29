import { validate } from "class-validator";

import { ReserveCompanionProfileMediaDto } from "./reserve-companion-profile-media.dto";

describe("ReserveCompanionProfileMediaDto", () => {
  it("accepts bounded image uploads", async () => {
    const dto = Object.assign(new ReserveCompanionProfileMediaDto(), {
      mimeType: "image/webp",
      sizeBytes: 512_000,
      sha256: "a".repeat(64)
    });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it("rejects non-image media, oversized payloads and invalid hashes", async () => {
    const dto = Object.assign(new ReserveCompanionProfileMediaDto(), {
      mimeType: "audio/mpeg",
      sizeBytes: 5 * 1024 * 1024,
      sha256: "not-a-hash"
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual(["mimeType", "sha256", "sizeBytes"]);
  });
});
