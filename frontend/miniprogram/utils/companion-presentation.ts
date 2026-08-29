import { Companion } from "./models";

type CompanionPresentationSource = Pick<
  Companion,
  "availability" | "rating" | "reviewCount" | "completedOrders"
>;

const AVAILABILITY_LABELS: Record<Companion["availability"], string> = {
  online: "在线",
  available: "可约",
  busy: "暂忙"
};

export function companionAvailabilityText(value: Companion["availability"]): string {
  return AVAILABILITY_LABELS[value] || "状态待确认";
}

export function companionRatingText(companion: CompanionPresentationSource): string {
  if (companion.reviewCount > 0) return `★ ${companion.rating}`;
  const completedOrders = companion.completedOrders ?? 0;
  if (completedOrders > 0) return `${completedOrders} 单完成`;
  return "暂无公开评价";
}

export function companionMetaText(nextAvailableText: string, companion: CompanionPresentationSource): string {
  return `${nextAvailableText} · ${companionRatingText(companion)}`;
}
