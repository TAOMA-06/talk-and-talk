import { Injectable } from "@nestjs/common";

export type MetricsSnapshot = {
  requestsTotal: number;
  errorsTotal: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  aiFailures: number;
  wechatNotifyFailures: number;
  wechatNotifySuccess: number;
};

type DurationSample = {
  at: number;
  durationMs: number;
};

@Injectable()
export class MetricsService {
  private requestsTotal = 0;
  private errorsTotal = 0;
  private aiFailures = 0;
  private wechatNotifyFailures = 0;
  private wechatNotifySuccess = 0;
  private latencySumMs = 0;
  private readonly durations: DurationSample[] = [];
  private readonly windowMs = 15 * 60 * 1000;
  private readonly maxSamples = 5000;

  recordRequest(durationMs: number, statusCode: number) {
    this.requestsTotal += 1;
    this.latencySumMs += durationMs;
    this.pushDuration(durationMs);
    if (statusCode >= 400) {
      this.errorsTotal += 1;
    }
  }

  recordAiFailure() {
    this.aiFailures += 1;
  }

  recordWechatNotifyFailure() {
    this.wechatNotifyFailures += 1;
  }

  recordWechatNotifySuccess() {
    this.wechatNotifySuccess += 1;
  }

  snapshot(): MetricsSnapshot {
    this.pruneDurations();
    const samples = this.durations.map((item) => item.durationMs);
    const requestsTotal = this.requestsTotal;
    const errorsTotal = this.errorsTotal;

    return {
      requestsTotal,
      errorsTotal,
      errorRate: requestsTotal === 0 ? 0 : Number((errorsTotal / requestsTotal).toFixed(4)),
      avgLatencyMs: requestsTotal === 0 ? 0 : Math.round(this.latencySumMs / requestsTotal),
      p95LatencyMs: this.percentile(samples, 0.95),
      aiFailures: this.aiFailures,
      wechatNotifyFailures: this.wechatNotifyFailures,
      wechatNotifySuccess: this.wechatNotifySuccess
    };
  }

  toPrometheusText(appVersion: string, appEnv: string): string {
    const metrics = this.snapshot();
    const lines = [
      "# HELP talk_http_requests_total Total HTTP requests handled by the API",
      "# TYPE talk_http_requests_total counter",
      `talk_http_requests_total{app_version="${appVersion}",app_env="${appEnv}"} ${metrics.requestsTotal}`,
      "# HELP talk_http_errors_total Total HTTP responses with status >= 400",
      "# TYPE talk_http_errors_total counter",
      `talk_http_errors_total{app_version="${appVersion}",app_env="${appEnv}"} ${metrics.errorsTotal}`,
      "# HELP talk_http_error_rate Ratio of HTTP errors to total requests",
      "# TYPE talk_http_error_rate gauge",
      `talk_http_error_rate{app_version="${appVersion}",app_env="${appEnv}"} ${metrics.errorRate}`,
      "# HELP talk_http_request_duration_ms_avg Average HTTP request duration in milliseconds",
      "# TYPE talk_http_request_duration_ms_avg gauge",
      `talk_http_request_duration_ms_avg{app_version="${appVersion}",app_env="${appEnv}"} ${metrics.avgLatencyMs}`,
      "# HELP talk_http_request_duration_ms_p95 P95 HTTP request duration in milliseconds",
      "# TYPE talk_http_request_duration_ms_p95 gauge",
      `talk_http_request_duration_ms_p95{app_version="${appVersion}",app_env="${appEnv}"} ${metrics.p95LatencyMs}`,
      "# HELP talk_ai_moderation_failures_total DeepSeek moderation failures",
      "# TYPE talk_ai_moderation_failures_total counter",
      `talk_ai_moderation_failures_total{app_version="${appVersion}",app_env="${appEnv}"} ${metrics.aiFailures}`,
      "# HELP talk_wechat_notify_failures_total WeChat payment notify failures",
      "# TYPE talk_wechat_notify_failures_total counter",
      `talk_wechat_notify_failures_total{app_version="${appVersion}",app_env="${appEnv}"} ${metrics.wechatNotifyFailures}`,
      "# HELP talk_wechat_notify_success_total Successful WeChat payment notify callbacks",
      "# TYPE talk_wechat_notify_success_total counter",
      `talk_wechat_notify_success_total{app_version="${appVersion}",app_env="${appEnv}"} ${metrics.wechatNotifySuccess}`
    ];
    return `${lines.join("\n")}\n`;
  }

  private pushDuration(durationMs: number) {
    this.durations.push({ at: Date.now(), durationMs });
    this.pruneDurations();
    if (this.durations.length > this.maxSamples) {
      this.durations.splice(0, this.durations.length - this.maxSamples);
    }
  }

  private pruneDurations() {
    const cutoff = Date.now() - this.windowMs;
    while (this.durations.length > 0 && this.durations[0].at < cutoff) {
      this.durations.shift();
    }
  }

  private percentile(samples: number[], ratio: number): number {
    if (samples.length === 0) {
      return 0;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
    return Math.round(sorted[index]);
  }
}