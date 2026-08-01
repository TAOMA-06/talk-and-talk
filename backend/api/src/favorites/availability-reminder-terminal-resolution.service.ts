import { HttpStatus, Injectable } from "@nestjs/common";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  AvailabilityReminderResolutionCode,
  ResolveAvailabilityReminderTerminalDto
} from "./dto/resolve-availability-reminder-terminal.dto";

const REQUIRED_CODE_BY_STATUS = {
  failedBeforeSend: "failedBeforeSendReviewed",
  rejected: "providerRejectedReviewed",
  uncertain: "uncertainProviderStateReconciled"
} as const satisfies Record<string, AvailabilityReminderResolutionCode>;

type TerminalStatus = keyof typeof REQUIRED_CODE_BY_STATUS;

@Injectable()
export class AvailabilityReminderTerminalResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async resolve(
    actorId: string,
    attemptId: string,
    dto: ResolveAvailabilityReminderTerminalDto,
    now = new Date()
  ) {
    const id = attemptId.trim();
    if (!id) this.throwNotFound();
    const note = dto.note?.trim() || null;
    const evidenceRef = dto.evidenceRef?.trim() || null;

    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await db.$queryRaw`
        SELECT "id" FROM "AvailabilityReminderAttempt"
        WHERE "id" = ${id}
        FOR UPDATE
      `;
      const attempt = await db.availabilityReminderAttempt.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          operationalResolvedAt: true,
          operationalResolvedById: true,
          operationalResolutionCode: true,
          operationalResolutionNote: true,
          operationalEvidenceRef: true,
          subscriptionGrant: { select: { userId: true } },
          handoff: {
            select: {
              candidate: { select: { companion: { select: { ownerUserId: true } } } }
            }
          }
        }
      });
      if (!attempt) this.throwNotFound();
      if (!(attempt.status in REQUIRED_CODE_BY_STATUS)) {
        throw new AppException(
          "AVAILABILITY_REMINDER_ATTEMPT_NOT_TERMINAL",
          "Only a terminal provider attempt can be operationally resolved",
          HttpStatus.CONFLICT
        );
      }
      const status = attempt.status as TerminalStatus;
      if (dto.resolutionCode !== REQUIRED_CODE_BY_STATUS[status]) {
        throw new AppException(
          "AVAILABILITY_REMINDER_RESOLUTION_CODE_MISMATCH",
          "The resolution code does not match the retained terminal provider state",
          HttpStatus.CONFLICT
        );
      }
      if (attempt.operationalResolvedAt) {
        const sameResolution = attempt.operationalResolutionCode === dto.resolutionCode
          && (attempt.operationalResolutionNote ?? null) === note
          && (attempt.operationalEvidenceRef ?? null) === evidenceRef;
        if (!sameResolution) {
          throw new AppException(
            "AVAILABILITY_REMINDER_ATTEMPT_ALREADY_RESOLVED",
            "This terminal attempt already has a different operational resolution",
            HttpStatus.CONFLICT
          );
        }
        return this.toResult(attempt, true);
      }

      // The originating action is an automated provider call, not a human
      // approval, so a second operator is not meaningful here. The current
      // authenticated operations/admin actor is retained and audited instead.
      const resolved = await db.availabilityReminderAttempt.update({
        where: { id: attempt.id },
        data: {
          operationalResolvedAt: now,
          operationalResolvedById: actorId,
          operationalResolutionCode: dto.resolutionCode,
          operationalResolutionNote: note,
          operationalEvidenceRef: evidenceRef
        },
        select: {
          id: true,
          status: true,
          operationalResolvedAt: true,
          operationalResolvedById: true,
          operationalResolutionCode: true,
          operationalResolutionNote: true,
          operationalEvidenceRef: true
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [
          attempt.subscriptionGrant?.userId,
          attempt.handoff?.candidate?.companion?.ownerUserId
        ].filter((candidate): candidate is string => Boolean(candidate)),
        action: "availability_reminder.terminal_attempt_resolved",
        resourceType: "availabilityReminderAttempt",
        resourceId: attempt.id,
        metadata: {
          terminalStatus: status,
          resolutionCode: dto.resolutionCode,
          hasNote: Boolean(note),
          hasEvidenceRef: Boolean(evidenceRef),
          automaticResend: false
        }
      }, db);
      return this.toResult(resolved, false);
    });
  }

  private toResult(attempt: any, idempotent: boolean) {
    return {
      id: attempt.id,
      terminalStatus: attempt.status,
      resolved: true,
      idempotent,
      automaticResend: false,
      operationalResolvedAt: attempt.operationalResolvedAt.toISOString(),
      operationalResolvedById: attempt.operationalResolvedById,
      resolutionCode: attempt.operationalResolutionCode,
      note: attempt.operationalResolutionNote ?? null,
      evidenceRef: attempt.operationalEvidenceRef ?? null
    };
  }

  private throwNotFound(): never {
    throw new AppException(
      "AVAILABILITY_REMINDER_ATTEMPT_NOT_FOUND",
      "Availability reminder attempt not found",
      HttpStatus.NOT_FOUND
    );
  }
}
