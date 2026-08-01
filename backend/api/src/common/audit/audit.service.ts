import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import { redactSecrets } from "../logging/redact";
import {
  auditActionSubjectPolicy,
  buildAuditSubjectReferenceWrites,
} from "./audit-subject-reference";

export type AuditRecordInput = {
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Business subjects are explicit; metadata is never heuristically parsed. */
  subjectUserIds?: readonly string[];
};

type AuditDatabase = {
  auditLog: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput, database: AuditDatabase = this.prisma) {
    const subjectPolicy = auditActionSubjectPolicy(input.action);
    if ((subjectPolicy === "explicitBusinessSubject" || subjectPolicy === "systemWithSubject")
      && (!input.subjectUserIds || input.subjectUserIds.length === 0)) {
      throw new Error(`Controlled audit action requires explicit subjectUserIds: ${input.action}`);
    }
    if (subjectPolicy === "actorOnly" && (!input.actorId || input.actorId === "system")) {
      throw new Error(`Actor-only audit action requires a user actor: ${input.action}`);
    }
    if ((subjectPolicy === "systemWithSubject" || subjectPolicy === "systemOperational")
      && input.actorId !== undefined && input.actorId !== null && input.actorId !== "system") {
      throw new Error(`System audit action cannot use a user actor: ${input.action}`);
    }
    if (subjectPolicy === "systemOperational" && (input.subjectUserIds?.length ?? 0) > 0) {
      throw new Error(`System operational audit action cannot name business subjects: ${input.action}`);
    }
    const metadata = input.metadata ? redactSecrets(input.metadata) : null;
    const subjectReferences = buildAuditSubjectReferenceWrites(input.actorId, input.subjectUserIds);
    return database.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        metadata: metadata as any,
        ...(subjectReferences.length
          ? { subjectReferences: { create: subjectReferences } }
          : {})
      }
    } as any);
  }
}
