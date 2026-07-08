import { ExecutionContext } from "@nestjs/common";
import { of, lastValueFrom } from "rxjs";

import { EnvelopeInterceptor } from "./envelope.interceptor";

describe("EnvelopeInterceptor", () => {
  it("wraps successful responses with data and meta", async () => {
    const interceptor = new EnvelopeInterceptor();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: "req-123" })
      })
    } as ExecutionContext;

    const result = await lastValueFrom(
      interceptor.intercept(context, {
        handle: () => of({ ok: true })
      })
    );

    expect(result.data).toEqual({ ok: true });
    expect(result.meta.requestId).toBe("req-123");
    expect(result.meta.timestamp).toEqual(expect.any(String));
  });
});
