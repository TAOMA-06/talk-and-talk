import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import { Observable, map } from "rxjs";

import type { RequestWithId } from "../middleware/request-with-id";
import type { ApiSuccessEnvelope } from "./api-envelope";

@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccessEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessEnvelope<T>> {
    const request = context.switchToHttp().getRequest<RequestWithId>();

    return next.handle().pipe(
      map((data) => ({
        data,
        meta: {
          requestId: request.requestId ?? "unknown",
          timestamp: new Date().toISOString()
        }
      }))
    );
  }
}
