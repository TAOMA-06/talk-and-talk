import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";
import { ConfigService } from "@nestjs/config";

export function buildCorsOptions(config: ConfigService): CorsOptions {
  const allowedOrigins = config.getOrThrow<string[]>("CORS_ORIGINS");

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-request-id"],
    exposedHeaders: ["x-request-id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  };
}
