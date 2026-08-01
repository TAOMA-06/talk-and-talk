import { AvailabilityReminderOperationsController } from "./availability-reminder-operations.controller";

describe("AvailabilityReminderOperationsController", () => {
  const fanout = {
    operationalReadiness: jest.fn(),
    retryFailedJob: jest.fn()
  } as any;
  const reservations = { operationalReadiness: jest.fn() } as any;
  const workerRetries = {
    retryPreparation: jest.fn(),
    retryReservation: jest.fn(),
    retryDelivery: jest.fn()
  } as any;
  const terminalResolutions = { resolve: jest.fn() } as any;
  const controller = new AvailabilityReminderOperationsController(
    fanout,
    reservations,
    workerRetries,
    terminalResolutions
  );

  beforeEach(() => jest.clearAllMocks());

  it("returns the strictest fanout and handoff-reservation readiness", async () => {
    fanout.operationalReadiness.mockResolvedValue({ status: "processing", backlog: { total: 2 } });
    reservations.operationalReadiness.mockResolvedValue({ status: "attentionRequired", pending: 3 });
    await expect(controller.readiness()).resolves.toEqual({
      status: "attentionRequired",
      backlog: { total: 2 },
      pipeline: { status: "attentionRequired", pending: 3 }
    });
  });

  it("binds a failed-job retry to the authenticated operator", async () => {
    fanout.retryFailedJob.mockResolvedValue({ id: "job-1", status: "retryScheduled" });
    await expect(controller.retryFailedJob({ id: "operator-1" } as any, "job-1"))
      .resolves.toMatchObject({ status: "retryScheduled" });
    expect(fanout.retryFailedJob).toHaveBeenCalledWith("operator-1", "job-1");
  });

  it("routes failed stage retries with the authenticated operator", async () => {
    workerRetries.retryPreparation.mockResolvedValue({ status: "retryScheduled" });
    workerRetries.retryReservation.mockResolvedValue({ status: "retryScheduled" });
    workerRetries.retryDelivery.mockResolvedValue({ status: "retryScheduled" });
    await controller.retryFailedPreparation({ id: "operator-1" } as any, "candidate-1");
    await controller.retryFailedReservation({ id: "operator-1" } as any, "handoff-1");
    await controller.retryFailedDelivery({ id: "operator-1" } as any, "attempt-1");
    expect(workerRetries.retryPreparation).toHaveBeenCalledWith("operator-1", "candidate-1");
    expect(workerRetries.retryReservation).toHaveBeenCalledWith("operator-1", "handoff-1");
    expect(workerRetries.retryDelivery).toHaveBeenCalledWith("operator-1", "attempt-1");
  });

  it("routes terminal reconciliation without offering an automatic resend", async () => {
    const dto = {
      resolutionCode: "uncertainProviderStateReconciled",
      note: "Provider dashboard checked",
      evidenceRef: "ops://incident/REM-1"
    } as any;
    terminalResolutions.resolve.mockResolvedValue({
      id: "attempt-1",
      terminalStatus: "uncertain",
      resolved: true,
      automaticResend: false
    });

    await expect(controller.resolveTerminalAttempt(
      { id: "operator-1" } as any,
      "attempt-1",
      dto
    )).resolves.toMatchObject({ resolved: true, automaticResend: false });
    expect(terminalResolutions.resolve).toHaveBeenCalledWith("operator-1", "attempt-1", dto);
  });
});
