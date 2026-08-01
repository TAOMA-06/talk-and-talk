type NotificationDeliveryConfig = {
  get<T = unknown>(key: string, fallback?: T): T | undefined;
};

export const NOTIFICATION_DELIVERY_DEFAULT_INTERVAL_SECONDS = 30;
export const NOTIFICATION_DELIVERY_MIN_READINESS_SLA_SECONDS = 120;

export function notificationDeliveryIntervalSeconds(config: NotificationDeliveryConfig): number {
  const configured = Number(config.get<number>(
    "NOTIFICATION_DELIVERY_INTERVAL_SECONDS",
    NOTIFICATION_DELIVERY_DEFAULT_INTERVAL_SECONDS
  ));
  if (!Number.isFinite(configured)) return NOTIFICATION_DELIVERY_DEFAULT_INTERVAL_SECONDS;
  return Math.min(60 * 60, Math.max(5, Math.floor(configured)));
}

export function notificationDeliveryReadinessSlaSeconds(config: NotificationDeliveryConfig): number {
  return Math.max(
    NOTIFICATION_DELIVERY_MIN_READINESS_SLA_SECONDS,
    notificationDeliveryIntervalSeconds(config) * 2
  );
}
