import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { VoiceRoomControlService } from "./voice-room-control.service";

/**
 * Durable backstop for room closes that could not be delivered inline during a
 * refund/complete transition. Work is claimed in PostgreSQL, so restarts and
 * multiple Cloud Run replicas cannot silently lose a termination request.
 */
@Injectable()
export class VoiceRoomTerminationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceRoomTerminationWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly rooms: VoiceRoomControlService
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>("TRTC_ROOM_CONTROL_ENABLED")) return;
    const intervalMs = (this.config.get<number>("TRTC_ROOM_CONTROL_INTERVAL_SECONDS") ?? 15) * 1_000;
    this.timer = setInterval(() => this.dismissDueSafely(), intervalMs);
    this.timer.unref?.();
    this.dismissDueSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dismissDue() {
    if (this.running || !this.config.get<boolean>("TRTC_ROOM_CONTROL_ENABLED")) {
      return { skipped: true, claimed: 0, terminated: 0, retriesScheduled: 0 };
    }
    this.running = true;
    try {
      const batchSize = this.config.get<number>("TRTC_ROOM_CONTROL_BATCH_SIZE") ?? 10;
      const result = await this.rooms.dismissDueRooms(batchSize);
      if (result.retriesScheduled > 0) {
        this.logger.warn(`Scheduled retries for ${result.retriesScheduled} voice room(s).`);
      } else if (result.terminated > 0) {
        this.logger.log(`Terminated ${result.terminated} voice room(s).`);
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private dismissDueSafely(): void {
    void this.dismissDue().catch((error) => {
      this.logger.error(`Voice-room termination scan failed (${error instanceof Error ? error.name : "unknown_error"}).`);
    });
  }
}
