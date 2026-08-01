import { AuditService } from "./audit.service";

describe("AuditService", () => {
  it("stores redacted metadata", async () => {
    const create = jest.fn().mockResolvedValue({ id: "a1" });
    const prisma = { auditLog: { create } } as any;
    const service = new AuditService(prisma);

    await service.record({
      actorId: "system",
      subjectUserIds: ["u1"],
      action: "payment.fulfilled",
      resourceType: "order",
      resourceId: "o1",
      metadata: { phone: "13800138000", code: "123456", amountCents: 3900 }
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "payment.fulfilled",
        metadata: expect.objectContaining({
          phone: "138****8000",
          code: "[REDACTED]",
          amountCents: 3900
        }),
        subjectReferences: {
          create: [{ subjectUserId: "u1", relationKind: "subject" }]
        }
      })
    });
  });

  it("atomically includes the actor and explicit business subjects without duplicates", async () => {
    const create = jest.fn().mockResolvedValue({ id: "a-subjects" });
    const service = new AuditService({ auditLog: { create } } as any);

    await service.record({
      actorId: "staff-1",
      action: "account.deletion_processing_started",
      resourceType: "accountDeletionRequest",
      resourceId: "request-1",
      subjectUserIds: ["user-1", "user-1", "staff-1"],
      metadata: { userId: "user-1" }
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subjectReferences: {
          create: [
            { subjectUserId: "staff-1", relationKind: "actorAndSubject" },
            { subjectUserId: "user-1", relationKind: "subject" }
          ]
        }
      })
    });
  });

  it("fails closed for an unclassified action instead of inferring arbitrary metadata", async () => {
    const create = jest.fn().mockResolvedValue({ id: "a-no-subject" });
    const service = new AuditService({ auditLog: { create } } as any);

    await expect(service.record({
      action: "unregistered.action",
      resourceType: "example",
      metadata: { userId: "must-not-be-inferred" }
    })).rejects.toThrow("Unclassified audit action: unregistered.action");

    expect(create).not.toHaveBeenCalled();
  });

  it("fails closed when a controlled action omits its explicit business subjects", async () => {
    const create = jest.fn();
    const service = new AuditService({ auditLog: { create } } as any);

    await expect(service.record({
      actorId: "staff-1",
      action: "account.deletion_processing_started",
      resourceType: "accountDeletionRequest",
      metadata: { userId: "user-1" }
    })).rejects.toThrow(
      "Controlled audit action requires explicit subjectUserIds: account.deletion_processing_started"
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("fails closed when a controlled action declares an empty subject list", async () => {
    const create = jest.fn();
    const service = new AuditService({ auditLog: { create } } as any);

    await expect(service.record({
      actorId: "staff-1",
      subjectUserIds: [],
      action: "account.deletion_processing_started",
      resourceType: "accountDeletionRequest"
    })).rejects.toThrow(
      "Controlled audit action requires explicit subjectUserIds: account.deletion_processing_started"
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("can write through a transaction-scoped audit client", async () => {
    const rootCreate = jest.fn();
    const transactionCreate = jest.fn().mockResolvedValue({ id: "a2" });
    const service = new AuditService({ auditLog: { create: rootCreate } } as any);

    await service.record(
      {
        actorId: "u1",
        subjectUserIds: ["u1"],
        action: "legal.consent_recorded",
        resourceType: "legalConsentReceipt",
        resourceId: "lc1",
        metadata: { version: "2.0-2026-07-20" }
      },
      { auditLog: { create: transactionCreate } } as any
    );

    expect(transactionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "legal.consent_recorded", resourceId: "lc1" })
    }));
    expect(rootCreate).not.toHaveBeenCalled();
  });

  it("rejects actor-only actions without a real user actor", async () => {
    const create = jest.fn();
    const service = new AuditService({ auditLog: { create } } as any);

    await expect(service.record({
      actorId: "system",
      action: "user.login",
      resourceType: "session"
    })).rejects.toThrow("Actor-only audit action requires a user actor: user.login");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a user actor for a system-owned action", async () => {
    const create = jest.fn();
    const service = new AuditService({ auditLog: { create } } as any);

    await expect(service.record({
      actorId: "staff-1",
      subjectUserIds: ["user-1"],
      action: "payment.fulfilled",
      resourceType: "payment"
    })).rejects.toThrow("System audit action cannot use a user actor: payment.fulfilled");
    expect(create).not.toHaveBeenCalled();
  });

  it("allows aggregate system operations without inventing a business subject", async () => {
    const create = jest.fn().mockResolvedValue({ id: "aggregate-1" });
    const service = new AuditService({ auditLog: { create } } as any);

    await service.record({
      actorId: "system",
      action: "wechat.bill_imported_and_reconciled",
      resourceType: "wechatBillImport"
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ subjectReferences: expect.anything() })
    });
  });

  it("rejects named subjects on aggregate system operations", async () => {
    const create = jest.fn();
    const service = new AuditService({ auditLog: { create } } as any);

    await expect(service.record({
      actorId: "system",
      subjectUserIds: ["user-1"],
      action: "wechat.bill_imported_and_reconciled",
      resourceType: "wechatBillImport"
    })).rejects.toThrow(
      "System operational audit action cannot name business subjects: wechat.bill_imported_and_reconciled"
    );
    expect(create).not.toHaveBeenCalled();
  });
});
