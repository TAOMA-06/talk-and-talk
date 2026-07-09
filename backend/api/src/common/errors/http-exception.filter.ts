import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import type { Response } from "express";

import type { ApiErrorEnvelope } from "../envelope/api-envelope";
import type { RequestWithId } from "../middleware/request-with-id";

type ErrorBody = {
  code?: string;
  message?: string | string[];
  details?: unknown;
  error?: string;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = exception instanceof HttpException
      ? this.normalizeHttpException(exception)
      : {
          code: "INTERNAL_ERROR",
          message: "Unexpected server error"
        };

    if (!(exception instanceof HttpException)) {
      // Keep unexpected error output server-side while returning a stable public shape.
      console.error(`[${request.requestId ?? "unknown"}] Unexpected error`, exception);
    }

    const payload: ApiErrorEnvelope = {
      error: {
        code: body.code,
        message: body.message,
        ...(body.details === undefined ? {} : { details: body.details })
      },
      meta: {
        requestId: request.requestId ?? "unknown",
        timestamp: new Date().toISOString()
      }
    };

    response.status(status).json(payload);
  }

  private normalizeHttpException(exception: HttpException): {
    code: string;
    message: string;
    details?: unknown;
  } {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === "string") {
      return {
        code: this.codeForStatus(status),
        message: response
      };
    }

    const body = response as ErrorBody;
    const message = Array.isArray(body.message)
      ? body.message.join("; ")
      : body.message ?? body.error ?? exception.message;

    return {
      code: body.code ?? this.codeForStatus(status),
      message,
      details: body.details ?? (Array.isArray(body.message) ? { messages: body.message } : undefined)
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return "BAD_REQUEST";
      case HttpStatus.UNAUTHORIZED:
        return "UNAUTHORIZED";
      case HttpStatus.FORBIDDEN:
        return "FORBIDDEN";
      case HttpStatus.NOT_FOUND:
        return "NOT_FOUND";
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return "VALIDATION_ERROR";
      default:
        return status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR";
    }
  }
}
