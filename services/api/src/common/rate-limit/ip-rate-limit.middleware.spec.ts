import { clientIp } from "./ip-rate-limit.middleware";

describe("clientIp", () => {
  it("prefers x-forwarded-for first hop", () => {
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      ip: "10.0.0.1",
      socket: { remoteAddress: "10.0.0.1" }
    } as any;
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to req.ip", () => {
    const req = {
      headers: {},
      ip: "9.9.9.9",
      socket: { remoteAddress: "10.0.0.1" }
    } as any;
    expect(clientIp(req)).toBe("9.9.9.9");
  });
});
