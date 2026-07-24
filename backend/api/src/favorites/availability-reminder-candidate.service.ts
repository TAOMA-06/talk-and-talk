import { Injectable } from "@nestjs/common";

import { publicFavoriteCompanionWhere } from "./favorite-companion-eligibility";

type CandidateWindow = {
  id: string;
  companionId: string;
  startsAt: Date;
  capacity: number;
  isActive: boolean;
  updatedAt: Date;
};

/**
 * Turns one owner-created or reactivated structured window into a bounded,
 * internal candidate set. It intentionally has no dependency on a delivery
 * worker, notification model, order details, conversation, or user profile.
 * The later delivery path must treat every row as a hint and recheck all live
 * eligibility, capacity, authorization, and frequency conditions.
 */
@Injectable()
export class AvailabilityReminderCandidateService {
  async recordWindowBecameAvailable(db: any, window: CandidateWindow) {
    if (!this.isFutureActiveWindow(window)) return { created: 0 };

    const favorites = await db.companionFavorite.findMany({
      where: {
        companionId: window.companionId,
        availabilityReminderEnabled: true,
        availabilityReminderGrantId: { not: null },
        companion: { is: publicFavoriteCompanionWhere() }
      },
      select: { id: true }
    });
    if (!favorites.length) return { created: 0 };

    // The unique favorite/window/version key makes a repeated write or retry
    // safe while still allowing a later true reactivation of the same window
    // to become a separate candidate.
    // No recipient-facing record, reminder schedule, or delivery is created.
    const result = await db.availabilityReminderCandidate.createMany({
      data: favorites.map((favorite: { id: string }) => ({
        favoriteId: favorite.id,
        companionId: window.companionId,
        availabilityWindowId: window.id,
        availabilityWindowUpdatedAt: window.updatedAt
      })),
      skipDuplicates: true
    });
    return { created: result.count };
  }

  private isFutureActiveWindow(window: CandidateWindow) {
    return window.isActive
      && Number.isInteger(window.capacity)
      && window.capacity > 0
      && window.startsAt.getTime() > Date.now();
  }
}
