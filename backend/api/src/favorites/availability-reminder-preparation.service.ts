import { Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { AvailabilityReminderHandoffService } from "./availability-reminder-handoff.service";
import { AvailabilityReminderPreflightService } from "./availability-reminder-preflight.service";

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;

export type AvailabilityReminderPreparationResult = {
  scanned: number;
  eligible: number;
  skipped: number;
  handedOff: number;
  alreadyHandedOff: number;
  disappeared: number;
};

/**
 * A bounded, server-internal preparation pass. It intentionally has no
 * lifecycle hook, timer, controller, queue producer, or provider dependency:
 * a future operational worker must opt in to call it. This service reads only
 * candidate ids, then delegates all live eligibility and handoff writes to the
 * narrowly scoped services that own those boundaries.
 */
@Injectable()
export class AvailabilityReminderPreparationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preflight: AvailabilityReminderPreflightService,
    private readonly handoffs: AvailabilityReminderHandoffService
  ) {}

  async preparePending(limit = DEFAULT_BATCH_SIZE, now = new Date()): Promise<AvailabilityReminderPreparationResult> {
    const candidates = await this.prisma.availabilityReminderCandidate.findMany({
      where: {
        handoff: null,
        preflightDecision: { in: ["pending", "eligible"] }
      },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: this.normalizeLimit(limit)
    } as any) as Array<{ id: string }>;

    const result: AvailabilityReminderPreparationResult = {
      scanned: candidates.length,
      eligible: 0,
      skipped: 0,
      handedOff: 0,
      alreadyHandedOff: 0,
      disappeared: 0
    };

    // Sequential handling keeps the nested candidate/favorite/grant/window
    // locks short and predictable. A concurrent coordinator remains safe
    // because the delegated services lock and deduplicate per candidate.
    for (const candidate of candidates) {
      try {
        const decision = await this.preflight.evaluate(candidate.id, now);
        if (decision.decision === "skipped") {
          result.skipped += 1;
          continue;
        }

        result.eligible += 1;
        const handoff = await this.handoffs.createForEligibleCandidate(candidate.id);
        if (handoff.created) result.handedOff += 1;
        else result.alreadyHandedOff += 1;
      } catch (error) {
        // A bookmark removal or profile withdrawal can cascade-delete a row
        // after the bounded id scan. That is a safe no-op, not a retryable
        // customer-facing failure. All other errors remain visible to the
        // future caller rather than silently skipping a safety boundary.
        if (this.isCandidateNotFound(error)) {
          result.disappeared += 1;
          continue;
        }
        throw error;
      }
    }

    return result;
  }

  private normalizeLimit(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
    return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(value)));
  }

  private isCandidateNotFound(error: unknown) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND";
  }
}
