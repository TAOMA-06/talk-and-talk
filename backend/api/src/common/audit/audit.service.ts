import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import { redactSecrets } from "../logging/redact";

export type AuditRecordInput = {
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
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
    const metadata = input.metadata ? redactSecrets(input.metadata) : null;
    return database.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        metadata: metadata as any
      }
    } as any);
  }
}
