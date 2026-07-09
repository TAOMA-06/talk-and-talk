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
});
