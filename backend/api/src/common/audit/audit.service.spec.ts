import { AuditService } from "./audit.service";

describe("AuditService", () => {
  it("stores redacted metadata", async () => {
    const create = jest.fn().mockResolvedValue({ id: "a1" });
    const prisma = { auditLog: { create } } as any;
    const service = new AuditService(prisma);

    await service.record({
      actorId: "u1",
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
        })
      })
    });
  });

  it("can write through a transaction-scoped audit client", async () => {
    const rootCreate = jest.fn();
    const transactionCreate = jest.fn().mockResolvedValue({ id: "a2" });
    const service = new AuditService({ auditLog: { create: rootCreate } } as any);

    await service.record(
      {
        actorId: "u1",
        action: "legal.consent_recorded",
        resourceType: "legalConsentReceipt",
        resourceId: "lc1",
        metadata: { version: "1.0-2026-07-19" }
      },
      { auditLog: { create: transactionCreate } } as any
    );

    expect(transactionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "legal.consent_recorded", resourceId: "lc1" })
    }));
    expect(rootCreate).not.toHaveBeenCalled();
  });
});
