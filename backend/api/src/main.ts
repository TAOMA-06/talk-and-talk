import { join } from "node:path";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from "@nestjs/platform-express";
import { json, text, urlencoded } from "express";
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
  const apiPrefix = config.getOrThrow<string>("API_PREFIX").replace(/^\/+|\/+$/g, "");

  // Reverse-proxied deployments (staging + production) sit behind one trusted hop
  // (compose Nginx / CloudBase edge). Express then derives req.ip from the right-most
  // untrusted address instead of application code trusting a client-controlled
  // X-Forwarded-For value.
  const appEnv = config.getOrThrow<string>("APP_ENV");
  if (appEnv === "production" || appEnv === "staging") {
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
  // Large historical statements use a route-scoped text parser. This keeps
  // the ordinary JSON API at its small global limit while making the promised
  // 20 MiB import reachable without serializing the raw bill into JSON. The
  // text exists only on the request object and is never copied to rawBody.
  app.use(
    `/${apiPrefix}/admin/commercial/payment-reconciliation/merchant-imports/text`,
    text({ type: ["text/plain", "text/csv"], limit: "20mb", defaultCharset: "utf-8" })
  );
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
  router.get("/admin", (_req: any, res: any) => res.redirect(302, "/admin/"));
  router.get("/admin/", (_req: any, res: any) => res.sendFile(join(publicRoot, "admin", "index.html")));

  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors(buildCorsOptions(config));
  // Workers release Redis/DB leases in OnModuleDestroy. Without this, SIGTERM
  // during rolling deploys skips Nest lifecycle hooks and can leak leases.
  app.enableShutdownHooks();

  await app.listen(
    config.getOrThrow<number>("PORT"),
    config.getOrThrow<string>("HOST")
  );
}

void bootstrap();
