import { AvailabilityReminderWorkerRetryService } from "./availability-reminder-worker-retry.service";

const NOW = new Date("2026-08-01T09:30:00.000Z");

describe("AvailabilityReminderWorkerRetryService", () => {
  it.each([
    {
      method: "retryPreparation",
      delegateName: "availabilityReminderCandidate",
      failedField: "preparationFailedAt",
      failureCountField: "preparationFailureCount",
      nextAttemptField: "preparationNextAttemptAt",
      action: "availability_reminder.preparation_retry_scheduled",
      graph: {
        favorite: { userId: "customer-1" },
        companion: { ownerUserId: "companion-owner-1" }
      }
    },
    {
      method: "retryReservation",
      delegateName: "availabilityReminderHandoff",
      failedField: "reservationFailedAt",
      failureCountField: "reservationFailureCount",
      nextAttemptField: "reservationNextAttemptAt",
      action: "availability_reminder.reservation_retry_scheduled",
      graph: {
        candidate: {
          favorite: { userId: "customer-1" },
          companion: { ownerUserId: "companion-owner-1" }
        }
      }
    },
    {
      method: "retryDelivery",
      delegateName: "availabilityReminderAttempt",
      failedField: "deliveryFailedAt",
      failureCountField: "deliveryFailureCount",
      nextAttemptField: "deliveryNextAttemptAt",
      action: "availability_reminder.delivery_retry_scheduled",
      graph: {
        subscriptionGrant: { userId: "customer-1" },
        handoff: {
          candidate: { companion: { ownerUserId: "companion-owner-1" } }
        }
      }
    }
  ])("retries $delegateName with the exact customer and companion-owner subjects", async (input) => {
    const delegate = {
      findUnique: jest.fn()
        .mockResolvedValueOnce({
          id: "work-1",
          [input.failedField]: new Date("2026-08-01T09:00:00.000Z"),
          [input.failureCountField]: 3
        })
        .mockResolvedValueOnce(input.graph),
      update: jest.fn().mockResolvedValue({
        id: "work-1",
        [input.nextAttemptField]: NOW
      })
    };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      [input.delegateName]: delegate
    } as any;
    const prisma = {
      $transaction: jest.fn((callback: (transaction: typeof db) => unknown) => callback(db))
    } as any;
    const audit = { record: jest.fn().mockResolvedValue({}) } as any;
    const service = new AvailabilityReminderWorkerRetryService(prisma, audit);

    await expect((service as any)[input.method]("operator-1", "work-1", NOW)).resolves.toEqual({
      id: "work-1",
      status: "retryScheduled",
      nextAttemptAt: NOW.toISOString()
    });

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "operator-1",
      subjectUserIds: ["customer-1", "companion-owner-1"],
      action: input.action,
      resourceId: "work-1",
      metadata: { previousFailureCount: 3 }
    }), db);
  });
});
