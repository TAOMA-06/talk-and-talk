import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { CompanionLifecycleAdminController } from "./companion-lifecycle-admin.controller";
import { CompanionLifecycleController } from "./companion-lifecycle.controller";

describe("Companion lifecycle controllers", () => {
  const lifecycle = {
    overview: jest.fn(),
    commercialProfile: jest.fn(),
    submitCommercialProfile: jest.fn(),
    training: jest.fn(),
    submitTrainingAttempt: jest.fn(),
    quality: jest.fn(),
    actions: jest.fn(),
    appeal: jest.fn(),
    incidents: jest.fn(),
    createIncident: jest.fn(),
    withdrawals: jest.fn(),
    requestWithdrawal: jest.fn(),
    cancelWithdrawal: jest.fn(),
    createAccountAction: jest.fn(),
    resolveAppeal: jest.fn(),
    adminAppeals: jest.fn(),
    adminVoiceIntros: jest.fn(),
    createVoiceIntroReadUrl: jest.fn(),
    reviewVoiceIntro: jest.fn(),
    adminTraining: jest.fn(),
    adminReviewDue: jest.fn(),
    adminAccountActions: jest.fn(),
    adminIncidents: jest.fn(),
    resolveIncident: jest.fn(),
    adminWithdrawals: jest.fn(),
    updateWithdrawal: jest.fn()
  } as any;
  const companionController = new CompanionLifecycleController(lifecycle);
  const adminController = new CompanionLifecycleAdminController(lifecycle);
  const companionUser = { id: "owner-1" } as any;
  const adminUser = { id: "admin-1" } as any;

  beforeEach(() => jest.clearAllMocks());

  it("derives every companion read from the authenticated owner id", async () => {
    await companionController.overview(companionUser);
    await companionController.training(companionUser);
    await companionController.quality(companionUser);
    await companionController.actions(companionUser);
    await companionController.incidents(companionUser);
    await companionController.withdrawals(companionUser);

    for (const method of [lifecycle.overview, lifecycle.training, lifecycle.quality]) {
      expect(method).toHaveBeenCalledWith("owner-1");
    }
    expect(lifecycle.actions).toHaveBeenCalledWith("owner-1", undefined, 1, 50, undefined);
    expect(lifecycle.incidents).toHaveBeenCalledWith("owner-1", undefined, 1, 50);
    expect(lifecycle.withdrawals).toHaveBeenCalledWith("owner-1", undefined, 1, 50);
  });

  it("exposes explicit read queues for each lifecycle operation surface", async () => {
    const query = {
      appealStatus: "pending",
      voiceIntroStatus: "pendingReview",
      trainingStatus: "expired",
      active: "true",
      incidentStatus: "open",
      withdrawalStatus: "requested",
      page: 3,
      pageSize: 25
    } as any;

    await adminController.appeals(adminUser, query);
    await adminController.voiceIntros(query);
    await adminController.training(query);
    await adminController.reviewDue(query);
    await adminController.actions(query);
    await adminController.incidents(query);
    await adminController.withdrawals(query);

    expect(lifecycle.adminAppeals).toHaveBeenCalledWith("admin-1", "pending", 3, 25);
    expect(lifecycle.adminVoiceIntros).toHaveBeenCalledWith("pendingReview", 3, 25);
    expect(lifecycle.adminTraining).toHaveBeenCalledWith("expired", 3, 25);
    expect(lifecycle.adminReviewDue).toHaveBeenCalledWith(3, 25);
    expect(lifecycle.adminAccountActions).toHaveBeenCalledWith(true, 3, 25);
    expect(lifecycle.adminIncidents).toHaveBeenCalledWith("open", 3, 25);
    expect(lifecycle.adminWithdrawals).toHaveBeenCalledWith("requested", 3, 25);
  });

  it("passes the authenticated administrator into every dangerous write", async () => {
    await adminController.resolveAppeal(adminUser, "appeal-1", {
      status: "upheld",
      resolution: "经二次核验，原处置证据充分并维持。"
    });
    await adminController.voiceIntroRead(adminUser, "companion-1");
    await adminController.reviewVoiceIntro(adminUser, "companion-1", {
      status: "approved",
      reviewedAssetReference: "evidence/voice/current.aac"
    });
    await adminController.resolveIncident(adminUser, "incident-1", {
      status: "resolved",
      resolution: "技术日志已核验并完成订单侧处理。"
    });
    await adminController.updateWithdrawal(adminUser, "withdrawal-1", { status: "reviewing" });

    expect(lifecycle.resolveAppeal).toHaveBeenCalledWith("admin-1", "appeal-1", expect.any(Object));
    expect(lifecycle.createVoiceIntroReadUrl).toHaveBeenCalledWith("admin-1", "companion-1");
    expect(lifecycle.reviewVoiceIntro).toHaveBeenCalledWith("admin-1", "companion-1", {
      status: "approved",
      reviewedAssetReference: "evidence/voice/current.aac"
    });
    expect(lifecycle.resolveIncident).toHaveBeenCalledWith("admin-1", "incident-1", expect.any(Object));
    expect(lifecycle.updateWithdrawal).toHaveBeenCalledWith("admin-1", "withdrawal-1", { status: "reviewing" });
  });

  it("separates supply lifecycle work from finance withdrawal work", () => {
    const prototype = CompanionLifecycleAdminController.prototype;
    for (const method of [
      prototype.createAction,
      prototype.resolveAppeal,
      prototype.appeals,
      prototype.voiceIntros,
      prototype.voiceIntroRead,
      prototype.reviewVoiceIntro,
      prototype.training,
      prototype.reviewDue,
      prototype.actions,
      prototype.incidents,
      prototype.resolveIncident
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, method)).toEqual(["supply", "admin"]);
    }
    expect(Reflect.getMetadata(ROLES_KEY, prototype.withdrawals)).toEqual(["finance", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.updateWithdrawal)).toEqual(["finance", "admin"]);
  });
});
