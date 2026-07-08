import { ConfigService } from "@nestjs/config";

import { buildCorsOptions } from "./cors";

function originResult(requestOrigin: string | undefined, allowedOrigins: string[]): Promise<boolean> {
  const options = buildCorsOptions({
    getOrThrow: jest.fn().mockReturnValue(allowedOrigins)
  } as unknown as ConfigService);

  return new Promise((resolve, reject) => {
    const originHandler = options.origin;
    if (typeof originHandler !== "function") {
      reject(new Error("Expected function origin handler"));
      return;
    }

    originHandler(requestOrigin as string, (error, allow) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Boolean(allow));
    });
  });
}

describe("buildCorsOptions", () => {
  it("allows configured origins", async () => {
    await expect(originResult("http://localhost:3000", ["http://localhost:3000"])).resolves.toBe(true);
  });

  it("allows requests without an origin header", async () => {
    await expect(originResult(undefined, ["http://localhost:3000"])).resolves.toBe(true);
  });

  it("rejects unconfigured origins", async () => {
    await expect(originResult("https://evil.example", ["http://localhost:3000"])).resolves.toBe(false);
  });
});
