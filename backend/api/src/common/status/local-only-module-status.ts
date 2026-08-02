import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Unauthenticated module probes stay local-only; external envs return 404. */
export function localOnlyModuleStatus(
  config: ConfigService,
  module: string
): { module: string; status: "active" } {
  const appEnv = config.getOrThrow<string>("APP_ENV");
  if (appEnv === "production" || appEnv === "staging") {
    throw new NotFoundException();
  }
  return { module, status: "active" };
}
