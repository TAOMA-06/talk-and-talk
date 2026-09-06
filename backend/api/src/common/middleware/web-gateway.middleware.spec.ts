import { WebGatewayMiddleware } from "./web-gateway.middleware";

describe("WebGatewayMiddleware", () => {
  const key = "a".repeat(48);
  function attempt(secret: string, supplied?: string, path = "/api/v1/companions") {
    const middleware = new WebGatewayMiddleware({ get: () => secret } as any);
    const req: any = { method: "GET", originalUrl: path, headers: {
      "x-talktalk-web-gateway": supplied, "x-wx-openid": "forged", "x-wx-appid": "forged"
    } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    middleware.use(req, res, next);
    return { req, res, next };
  }
  it("refuses requests with a missing or incorrect gateway secret", () => {
    for (const value of [undefined, "incorrect"]) {
      const result = attempt(key, value);
      expect(result.res.status).toHaveBeenCalledWith(403);
      expect(result.next).not.toHaveBeenCalled();
    }
  });
  it("strips all platform identity headers before serving a web gateway request", () => {
    const result = attempt(key, key);
    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.req.headers["x-wx-openid"]).toBeUndefined();
    expect(result.req.headers["x-wx-appid"]).toBeUndefined();
  });
  it("permits liveness probes but protects detailed readiness", () => {
    expect(attempt(key, undefined, "/api/v1/health").next).toHaveBeenCalled();
    expect(attempt(key, undefined, "/api/v1/health/ready").res.status).toHaveBeenCalledWith(403);
  });
  it("preserves deployments that do not enable the web gateway", () => {
    expect(attempt("").next).toHaveBeenCalled();
  });
});
