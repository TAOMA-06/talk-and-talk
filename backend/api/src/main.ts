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

  // The independent review workbench only loads same-origin, versioned static
  // assets. No inline script is permitted, which keeps its credential entry
  // screen outside the consumer application's script trust boundary.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'"]
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

  const publicRoot = join(__dirname, "..", "public");
  app.useStaticAssets(publicRoot, {
    index: false
  });
  const router: any = app.getHttpAdapter();
  router.get("/review", (_req: any, res: any) => res.redirect(302, "/review/"));
  router.get("/review/", (_req: any, res: any) => res.sendFile(join(publicRoot, "review", "index.html")));
  // Preserve a safe bookmark migration without leaving the former user-role
  // review dashboard available as an alternate data path.
  router.get("/admin", (_req: any, res: any) => res.redirect(302, "/review/"));
  router.get("/admin/", (_req: any, res: any) => res.redirect(302, "/review/"));

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
