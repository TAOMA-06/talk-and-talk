import { Injectable } from "@nestjs/common";

type CandidateWindow = {
  id: string;
  companionId: string;
  startsAt: Date;
  capacity: number;
  isActive: boolean;
  updatedAt: Date;
};

/**
 * Records one durable fanout job for an owner-created or reactivated window.
 * This method runs inside the owner calendar transaction, so its work must stay
 * O(1): it never scans bookmarks or writes one row per recipient. The bounded
 * fanout worker later expands the job into private candidates and all later
 * stages still recheck live eligibility and authorization.
 */
@Injectable()
export class AvailabilityReminderCandidateService {
  async recordWindowBecameAvailable(db: any, window: CandidateWindow) {
    if (!this.isFutureActiveWindow(window)) return { created: 0, queued: 0 };

    // The unique window/version key makes repeated calendar writes idempotent,
    // while a later real reactivation (and therefore a new updatedAt) becomes a
    // separate event. This is still neither a notification nor delivery proof.
    const result = await db.availabilityReminderFanoutJob.createMany({
      data: [{
        companionId: window.companionId,
        availabilityWindowId: window.id,
        availabilityWindowUpdatedAt: window.updatedAt,
        audienceCutoffAt: new Date()
      }],
      skipDuplicates: true
    });
    return { created: 0, queued: result.count };
  }

  private isFutureActiveWindow(window: CandidateWindow) {
    return window.isActive
      && Number.isInteger(window.capacity)
      && window.capacity > 0
      && window.startsAt.getTime() > Date.now();
  }
}
