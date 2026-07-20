import { join } from "node:path";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from "@nestjs/platform-express";
import { json, urlencoded } from "express";
import helmet from "helmet";
import "reflect-metadata";

import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/errors/http-exception.filter";
import { EnvelopeInterceptor } from "./common/envelope/envelope.interceptor";
import { buildCorsOptions } from "./config/cors";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false
  });
  const config = app.get(ConfigService);
  const bodyLimit = config.get<string>("BODY_SIZE_LIMIT") ?? "1mb";

  // Production is deployed behind exactly one trusted reverse-proxy hop (the compose Nginx
  // service). Express then derives req.ip from the right-most untrusted address instead of
  // application code trusting a client-controlled X-Forwarded-For value.
  if (config.getOrThrow<string>("APP_ENV") === "production") {
    app.set("trust proxy", 1);
  }

  // Keep Helmet's strict CSP while authorizing the reviewed, immutable admin bundle.
  // scripts/verify-production-artifacts.mjs recomputes this hash so an HTML edit
  // cannot silently ship a browser-blocked operations console.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", "'sha256-zE+aCHqEs7k+xLRRMzhge2ZdiHQ4hW7T/e5CrlpJryc='"]
      }
    }
  }));
  app.use(
    json({
      limit: bodyLimit,
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  app.useStaticAssets(join(__dirname, "..", "public"), {
    index: false
  });

  app.setGlobalPrefix(config.getOrThrow<string>("API_PREFIX"));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors(buildCorsOptions(config));

  await app.listen(
    config.getOrThrow<number>("PORT"),
    config.getOrThrow<string>("HOST")
  );
}

void bootstrap();
