import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateLegalConsentDto, GetLegalConsentDto } from "./legal-consent.dto";

describe("Legal consent DTOs", () => {
  const valid = {
    version: "1.0-2026-07-19",
    acceptedAt: "2026-07-19T08:00:00.000Z",
    privacyAccepted: true,
    termsAccepted: true,
    adultConfirmed: true,
    privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
    termsUrl: "https://api.talkandtalk.app/legal/terms.html",
    source: "wechatMiniProgram"
  };

  it("accepts the complete Mini Program legal receipt claim", async () => {
    await expect(validate(plainToInstance(CreateLegalConsentDto, valid))).resolves.toHaveLength(0);
  });

  it.each([
    [{ privacyAccepted: false }, "privacyAccepted"],
    [{ termsAccepted: false }, "termsAccepted"],
    [{ adultConfirmed: false }, "adultConfirmed"],
    [{ source: "web" }, "source"],
    [{ privacyUrl: "http://api.talkandtalk.app/legal/privacy.html" }, "privacyUrl"],
    [{ termsUrl: "not-a-url" }, "termsUrl"],
    [{ acceptedAt: "yesterday" }, "acceptedAt"],
    [{ version: "" }, "version"]
  ])("rejects invalid consent claim %p", async (override, property) => {
    const errors = await validate(plainToInstance(CreateLegalConsentDto, { ...valid, ...override }));
    expect(errors.some((error) => error.property === property)).toBe(true);
  });

  it("validates an optional version query", async () => {
    await expect(validate(plainToInstance(GetLegalConsentDto, {}))).resolves.toHaveLength(0);
    const errors = await validate(plainToInstance(GetLegalConsentDto, { version: "" }));
    expect(errors.some((error) => error.property === "version")).toBe(true);
  });
});
