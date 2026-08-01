import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { AuditService } from "../common/audit/audit.service";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class AvailabilityReminderWorkerRetryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  retryPreparation(actorId: string, candidateId: string, now = new Date()) {
    return this.retry({
      actorId,
      id: candidateId,
      now,
      table: "AvailabilityReminderCandidate",
      delegate: "availabilityReminderCandidate",
      failedField: "preparationFailedAt",
      failureCountField: "preparationFailureCount",
      nextAttemptField: "preparationNextAttemptAt",
      lastErrorField: "preparationLastErrorCode",
      leaseTokenField: "preparationLeaseToken",
      leaseExpiresField: "preparationLeaseExpiresAt",
      action: "availability_reminder.preparation_retry_scheduled",
      resourceType: "availabilityReminderCandidate",
      notFoundCode: "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND"
    });
  }

  retryReservation(actorId: string, handoffId: string, now = new Date()) {
    return this.retry({
      actorId,
      id: handoffId,
      now,
      table: "AvailabilityReminderHandoff",
      delegate: "availabilityReminderHandoff",
      failedField: "reservationFailedAt",
      failureCountField: "reservationFailureCount",
      nextAttemptField: "reservationNextAttemptAt",
      lastErrorField: "reservationLastErrorCode",
      leaseTokenField: "reservationLeaseToken",
      leaseExpiresField: "reservationLeaseExpiresAt",
      action: "availability_reminder.reservation_retry_scheduled",
      resourceType: "availabilityReminderHandoff",
      notFoundCode: "AVAILABILITY_REMINDER_HANDOFF_NOT_FOUND"
    });
  }

  retryDelivery(actorId: string, attemptId: string, now = new Date()) {
    return this.retry({
      actorId,
      id: attemptId,
      now,
      table: "AvailabilityReminderAttempt",
      delegate: "availabilityReminderAttempt",
      failedField: "deliveryFailedAt",
      failureCountField: "deliveryFailureCount",
      nextAttemptField: "deliveryNextAttemptAt",
      lastErrorField: "deliveryLastErrorCode",
      leaseTokenField: "deliveryClaimToken",
      leaseExpiresField: "deliveryClaimExpiresAt",
      action: "availability_reminder.delivery_retry_scheduled",
      resourceType: "availabilityReminderAttempt",
      notFoundCode: "AVAILABILITY_REMINDER_ATTEMPT_NOT_FOUND"
    });
  }

  private async retry(input: {
    actorId: string;
    id: string;
    now: Date;
    table: "AvailabilityReminderCandidate" | "AvailabilityReminderHandoff" | "AvailabilityReminderAttempt";
    delegate: "availabilityReminderCandidate" | "availabilityReminderHandoff" | "availabilityReminderAttempt";
    failedField: string;
    failureCountField: string;
    nextAttemptField: string;
    lastErrorField: string;
    leaseTokenField: string;
    leaseExpiresField: string;
    action: string;
    resourceType: string;
    notFoundCode: string;
  }) {
    const id = input.id.trim();
    if (!id) this.throwNotFound(input.notFoundCode);
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      // `table` is a closed internal union, never request input.
      if (input.table === "AvailabilityReminderCandidate") {
        await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderCandidate" WHERE "id" = ${id} FOR UPDATE`;
      } else if (input.table === "AvailabilityReminderHandoff") {
        await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderHandoff" WHERE "id" = ${id} FOR UPDATE`;
      } else {
        await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderAttempt" WHERE "id" = ${id} FOR UPDATE`;
      }
      const delegate = db[input.delegate];
      const record = await delegate.findUnique({
        where: { id },
        select: { id: true, [input.failedField]: true, [input.failureCountField]: true }
      });
      if (!record) this.throwNotFound(input.notFoundCode);
      if (!record[input.failedField]) {
        throw new AppException(
          "AVAILABILITY_REMINDER_WORK_ITEM_NOT_FAILED",
          "Only a failed availability reminder work item can be retried",
          HttpStatus.CONFLICT
        );
      }
      const subjectUserIds = await this.subjectUserIds(db, input.table, id);
      if (!subjectUserIds.length) {
        throw new Error("Availability reminder work item is missing its user subjects");
      }
      const previousFailureCount = record[input.failureCountField];
      const retried = await delegate.update({
        where: { id },
        data: {
          [input.failedField]: null,
          [input.failureCountField]: 0,
          [input.nextAttemptField]: input.now,
          [input.lastErrorField]: null,
          [input.leaseTokenField]: null,
          [input.leaseExpiresField]: null
        },
        select: { id: true, [input.nextAttemptField]: true }
      });
      await this.audit.record({
        actorId: input.actorId,
        subjectUserIds,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: id,
        metadata: { previousFailureCount }
      }, db);
      return {
        id: retried.id,
        status: "retryScheduled",
        nextAttemptAt: retried[input.nextAttemptField].toISOString()
      };
    });
  }

  private async subjectUserIds(
    db: any,
    table: "AvailabilityReminderCandidate" | "AvailabilityReminderHandoff" | "AvailabilityReminderAttempt",
    id: string
  ): Promise<string[]> {
    let customerUserId: string | null | undefined;
    let companionOwnerUserId: string | null | undefined;
    if (table === "AvailabilityReminderCandidate") {
      const item = await db.availabilityReminderCandidate.findUnique({
        where: { id },
        select: {
          favorite: { select: { userId: true } },
          companion: { select: { ownerUserId: true } }
        }
      });
      customerUserId = item?.favorite?.userId;
      companionOwnerUserId = item?.companion?.ownerUserId;
    } else if (table === "AvailabilityReminderHandoff") {
      const item = await db.availabilityReminderHandoff.findUnique({
        where: { id },
        select: {
          candidate: {
            select: {
              favorite: { select: { userId: true } },
              companion: { select: { ownerUserId: true } }
            }
          }
        }
      });
      customerUserId = item?.candidate?.favorite?.userId;
      companionOwnerUserId = item?.candidate?.companion?.ownerUserId;
    } else {
      const item = await db.availabilityReminderAttempt.findUnique({
        where: { id },
        select: {
          subscriptionGrant: { select: { userId: true } },
          handoff: {
            select: {
              candidate: { select: { companion: { select: { ownerUserId: true } } } }
            }
          }
        }
      });
      customerUserId = item?.subscriptionGrant?.userId;
      companionOwnerUserId = item?.handoff?.candidate?.companion?.ownerUserId;
    }
    return [...new Set([customerUserId, companionOwnerUserId]
      .filter((candidate): candidate is string => Boolean(candidate)))];
  }

  private throwNotFound(code: string): never {
    throw new AppException(code, "Availability reminder work item not found", HttpStatus.NOT_FOUND);
  }
}
