import { PublicCatalogSummary } from "./models";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;

export type CatalogDisplay<T extends { catalog?: PublicCatalogSummary }> = T & {
  catalogPriceText: string;
  catalogDetailText: string;
  nextAvailableText: string;
};

function formatYuan(cents: number): string {
  const yuan = cents / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
}

function formatNextAvailableAt(value: string | null | undefined): string {
  if (!value) return "可约时间以详情页为准";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "可约时间以详情页为准";
  const shanghai = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${shanghai.getUTCMonth() + 1}月${shanghai.getUTCDate()}日 ${pad(shanghai.getUTCHours())}:${pad(shanghai.getUTCMinutes())}（北京时间）起可约`;
}

/**
 * A profile's legacy price is not a current sales promise. Every surface that
 * presents a sellable recommendation uses this shared current-catalog view so
 * price, duration, delivery mode, and availability keep one meaning.
 */
export function withCatalogDisplay<T extends { catalog?: PublicCatalogSummary }>(item: T): CatalogDisplay<T> {
  const catalog = item.catalog;
  const sellable = catalog?.sellable === true;
  const validPrice = sellable
    && catalog.currency === "CNY"
    && Number.isInteger(catalog.startingPriceCents)
    && (catalog.startingPriceCents ?? 0) > 0;
  const validDuration = sellable
    && Number.isInteger(catalog.startingDurationMinutes)
    && (catalog.startingDurationMinutes ?? 0) >= 30;
  const modes = sellable
    ? [...new Set(catalog.deliveryModes)]
        .map((mode) => mode === "voice" ? "语音" : "文字")
        .join(" / ")
    : "";

  return {
    ...item,
    catalogPriceText: validPrice ? `¥${formatYuan(catalog.startingPriceCents!)} 起` : "查看当前商品",
    catalogDetailText: validDuration
      ? `起价商品 ${catalog.startingDurationMinutes} 分钟${modes ? ` · 可选方式：${modes}` : ""}`
      : "价格与方式以详情页为准",
    nextAvailableText: sellable ? formatNextAvailableAt(catalog.nextAvailableAt) : "可约时间以详情页为准"
  };
}

export function withCatalogDisplays<T extends { catalog?: PublicCatalogSummary }>(items: T[]): Array<CatalogDisplay<T>> {
  return items.map(withCatalogDisplay);
}
