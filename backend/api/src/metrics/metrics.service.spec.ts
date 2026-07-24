import { MetricsService } from "./metrics.service";

describe("MetricsService", () => {
  it("tracks requests, errors, and latency percentiles", () => {
    const metrics = new MetricsService();

    metrics.recordRequest(100, 200);
    metrics.recordRequest(200, 201);
    metrics.recordRequest(300, 500);
    metrics.recordAiFailure();
    metrics.recordWechatNotifyFailure();
    metrics.recordWechatNotifySuccess();
    metrics.recordAvailabilityReminderDeliveryFailure();
    metrics.recordAvailabilityReminderDeliverySuccess();
    metrics.recordAvailabilityReminderDeliverySkipped();

    const snapshot = metrics.snapshot();

    expect(snapshot.requestsTotal).toBe(3);
    expect(snapshot.errorsTotal).toBe(1);
    expect(snapshot.errorRate).toBeCloseTo(1 / 3, 4);
    expect(snapshot.avgLatencyMs).toBe(200);
    expect(snapshot.p95LatencyMs).toBeGreaterThanOrEqual(200);
    expect(snapshot.aiFailures).toBe(1);
    expect(snapshot.wechatNotifyFailures).toBe(1);
    expect(snapshot.wechatNotifySuccess).toBe(1);
    expect(snapshot.availabilityReminderDeliveryFailures).toBe(1);
    expect(snapshot.availabilityReminderDeliverySuccess).toBe(1);
    expect(snapshot.availabilityReminderDeliverySkipped).toBe(1);
  });

  it("renders prometheus text", () => {
    const metrics = new MetricsService();
    metrics.recordRequest(50, 200);

    const text = metrics.toPrometheusText("1.2.3", "staging");

    expect(text).toContain("talk_http_requests_total");
    expect(text).toContain('app_version="1.2.3"');
    expect(text).toContain('app_env="staging"');
    expect(text).toContain("talk_availability_reminder_delivery_success_total");
  });
});
