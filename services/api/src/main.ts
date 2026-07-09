import { join } from "node:path";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from "@nestjs/platform-express";
import "reflect-metadata";

import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/errors/http-exception.filter";
import { EnvelopeInterceptor } from "./common/envelope/envelope.interceptor";
import { buildCorsOptions } from "./config/cors";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true
  });
  const config = app.get(ConfigService);

  app.useStaticAssets(join(__dirname, "..", "public"), {
    index: false
  });

  app.setGlobalPrefix(config.getOrThrow<string>("API_PREFIX"));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors(buildCorsOptions(config));

  await app.listen(config.getOrThrow<number>("PORT"));
}

void bootstrap();
