import type { ConfigService } from "@nestjs/config";

/** First commercial launch surface. text_only blocks voice SKUs, voice rooms, and chat media. */
export type CommercialSurface = "text_only" | "full";

export function parseCommercialSurface(value: string | undefined): CommercialSurface {
  const normalized = (value ?? "text_only").trim().toLowerCase();
  if (normalized === "text_only" || normalized === "text-only") return "text_only";
  if (normalized === "full") return "full";
  throw new Error("COMMERCIAL_SURFACE must be text_only or full");
}

export function commercialSurface(config?: Pick<ConfigService, "get"> | null): CommercialSurface {
  const raw = config?.get<string | CommercialSurface>("COMMERCIAL_SURFACE", "text_only");
  if (raw === "full" || raw === "text_only") return raw;
  return parseCommercialSurface(typeof raw === "string" ? raw : undefined);
}

export function isCommercialTextOnlySurface(config?: Pick<ConfigService, "get"> | null): boolean {
  return commercialSurface(config) === "text_only";
}
