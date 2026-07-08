import { RequestIdMiddleware } from "./request-id.middleware";

describe("RequestIdMiddleware", () => {
  it("uses an incoming request id and writes it to the response", () => {
    const middleware = new RequestIdMiddleware();
    const next = jest.fn();
    const req = {
      header: jest.fn().mockReturnValue("client-req")
    } as never;
    const res = {
      setHeader: jest.fn()
    } as never;

    middleware.use(req, res, next);

    expect((req as { requestId: string }).requestId).toBe("client-req");
    expect((res as { setHeader: jest.Mock }).setHeader).toHaveBeenCalledWith("x-request-id", "client-req");
    expect(next).toHaveBeenCalled();
  });

  it("generates a request id when none is provided", () => {
    const middleware = new RequestIdMiddleware();
    const req = {
      header: jest.fn().mockReturnValue(undefined)
    } as never;
    const res = {
      setHeader: jest.fn()
    } as never;

    middleware.use(req, res, jest.fn());

    expect((req as { requestId: string }).requestId).toEqual(expect.any(String));
    expect((req as { requestId: string }).requestId.length).toBeGreaterThan(20);
  });
});
