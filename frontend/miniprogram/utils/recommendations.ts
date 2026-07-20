import { api } from "./api";
import { RecommendedCompanion } from "./models";

type QueuedRecommendationEvent = { impressionId: string; type: "view" | "click"; queuedAt: number };

const QUEUE_KEY = "talkandtalk.recommendationEvents.v1";
const MAX_QUEUE_SIZE = 100;
let flushInFlight: Promise<void> | null = null;

function readQueue(): QueuedRecommendationEvent[] {
  const value = wx.getStorageSync(QUEUE_KEY);
  return Array.isArray(value) ? value.filter((item) => item && typeof item.impressionId === "string") : [];
}

function writeQueue(events: QueuedRecommendationEvent[]): void {
  wx.setStorageSync(QUEUE_KEY, events.slice(-MAX_QUEUE_SIZE));
}

export function queueRecommendationEvent(impressionId: string | undefined, type: "view" | "click"): void {
  if (!impressionId) return;
  const events = readQueue();
  const existing = events.find((event) => event.impressionId === impressionId && event.type === type);
  if (existing) return;
  writeQueue([...events, { impressionId, type, queuedAt: Date.now() }]);
}

export async function flushRecommendationEvents(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  const snapshot = readQueue();
  if (snapshot.length === 0) return;
  flushInFlight = (async () => {
    try {
      await api.recordRecommendationEvents(snapshot.map(({ impressionId, type }) => ({ impressionId, type })));
      const sent = new Set(snapshot.map((event) => `${event.impressionId}:${event.type}`));
      writeQueue(readQueue().filter((event) => !sent.has(`${event.impressionId}:${event.type}`)));
    } catch {
      // Keep the local, bounded queue. A later page visit will retry without
      // blocking browsing or navigation on telemetry delivery.
    }
  })().finally(() => { flushInFlight = null; });
  return flushInFlight;
}

/**
 * In WeChat we count a view only after half of a card stays visible for one
 * second.  The fallback keeps development/web mocks observable without making
 * recommendation delivery depend on a non-essential browser API.
 */
export function trackRecommendationCardViews(
  page: any,
  companions: RecommendedCompanion[],
  selectorPrefix: string
): () => void {
  const createObserver = (wx as any).createIntersectionObserver;
  if (typeof createObserver !== "function") {
    for (const companion of companions) queueRecommendationEvent(companion.impressionId, "view");
    void flushRecommendationEvents();
    return () => undefined;
  }
  const observer = createObserver(page, { thresholds: [0.5] });
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const viewed = new Set<string>();
  for (const companion of companions) {
    observer.relativeToViewport().observe(`#${selectorPrefix}-${companion.impressionId}`, (result: any) => {
      if (viewed.has(companion.impressionId)) return;
      if (result.intersectionRatio >= 0.5) {
        if (timers.has(companion.impressionId)) return;
        timers.set(companion.impressionId, setTimeout(() => {
          timers.delete(companion.impressionId);
          viewed.add(companion.impressionId);
          queueRecommendationEvent(companion.impressionId, "view");
          void flushRecommendationEvents();
        }, 1000));
        return;
      }
      const timer = timers.get(companion.impressionId);
      if (timer) {
        clearTimeout(timer);
        timers.delete(companion.impressionId);
      }
    });
  }
  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    observer.disconnect();
    void flushRecommendationEvents();
  };
}
