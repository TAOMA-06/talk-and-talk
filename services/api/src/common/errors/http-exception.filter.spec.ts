import { BadRequestException, NotFoundException } from "@nestjs/common";

import { AppException } from "./app.exception";
import { HttpExceptionFilter } from "./http-exception.filter";

function createHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });

  return {
    response: { status },
    host: {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ requestId: "req-filter" })
      })
    } as never,
    json,
    status
  };
}

describe("HttpExceptionFilter", () => {
  it("wraps app exceptions", () => {
    const filter = new HttpExceptionFilter();
    const { host, json, status } = createHost();

    filter.catch(new AppException("DOMAIN_ERROR", "Domain failed", 422, { field: "name" }), host);

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "DOMAIN_ERROR",
        message: "Domain failed",
        details: { field: "name" }
      },
      meta: {
        requestId: "req-filter",
        timestamp: expect.any(String)
      }
    });
  });

  it("normalizes nest validation-style errors", () => {
    const filter = new HttpExceptionFilter();
    const { host, json, status } = createHost();

    filter.catch(new BadRequestException(["name must be a string"]), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "BAD_REQUEST",
        message: "name must be a string",
        details: { messages: ["name must be a string"] }
      },
      meta: {
        requestId: "req-filter",
        timestamp: expect.any(String)
      }
    });
  });

  it("returns not found as a stable error envelope", () => {
    const filter = new HttpExceptionFilter();
    const { host, json, status } = createHost();

    filter.catch(new NotFoundException("Missing"), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0][0].error.code).toBe("NOT_FOUND");
    expect(json.mock.calls[0][0].meta.requestId).toBe("req-filter");
  });
});
