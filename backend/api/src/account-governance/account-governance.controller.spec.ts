import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { SKIP_LEGAL_CONSENT_KEY } from "../auth/decorators/skip-legal-consent.decorator";
import { AccountGovernanceAdminController } from "./account-governance-admin.controller";
import { AccountGovernanceController } from "./account-governance.controller";
import { AccountGovernanceService } from "./account-governance.service";

describe("AccountGovernanceController", () => {
  const governance = {
    listSessions: jest.fn(),
    revokeSession: jest.fn(),
    revokeOtherSessions: jest.fn(),
    listMyDataRightsRequests: jest.fn(),
    createDataRightsRequest: jest.fn(),
    addDataRightsFollowUp: jest.fn(),
    listMyInvoiceRequests: jest.fn(),
    createInvoiceRequest: jest.fn(),
    cancelInvoiceRequest: jest.fn()
  };
  const accountActions = {
    listMy: jest.fn(),
    createAppeal: jest.fn()
  };
  const controller = new AccountGovernanceController(
    governance as unknown as AccountGovernanceService,
    accountActions as any
  );
  const user = { id: "user-1", role: "user", sessionId: "session-1" };

  beforeEach(() => jest.clearAllMocks());

  it("passes pagination and authenticated session assurance to session operations", () => {
    const query = { page: 2, pageSize: 25 };
    controller.sessions(user, query);
    controller.revokeSession(user, "session-2");
    controller.revokeOtherSessions(user);

    expect(governance.listSessions).toHaveBeenCalledWith("user-1", "session-1", 2, 25);
    expect(governance.revokeSession).toHaveBeenCalledWith("user-1", "session-2");
    expect(governance.revokeOtherSessions).toHaveBeenCalledWith("user-1", "session-1");
  });

  it("keeps sessions and data rights available without forcing a current legal receipt", () => {
    const prototype = AccountGovernanceController.prototype;
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.sessions)).toBe(true);
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.revokeOtherSessions)).toBe(true);
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.revokeSession)).toBe(true);
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.dataRights)).toBe(true);
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.createDataRights)).toBe(true);
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.addDataRightsFollowUp)).toBe(true);
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.accountActionHistory)).toBe(true);
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.createAccountActionAppeal)).toBe(true);
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.invoices)).toBeUndefined();
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.createInvoice)).toBeUndefined();
    expect(Reflect.getMetadata(SKIP_LEGAL_CONSENT_KEY, prototype.cancelInvoice)).toBe(true);
  });

  it("binds a data-rights follow-up to both the caller and request id", () => {
    controller.addDataRightsFollowUp(user, "rights-1", {
      statement: "补充最近一年的订单范围"
    });

    expect(governance.addDataRightsFollowUp).toHaveBeenCalledWith(
      "user-1",
      "rights-1",
      { statement: "补充最近一年的订单范围" }
    );
  });

  it("binds invoice cancellation to the authenticated requester", () => {
    controller.cancelInvoice(user, "invoice-1");
    expect(governance.cancelInvoiceRequest).toHaveBeenCalledWith("user-1", "invoice-1");
  });

  it("keeps locked-account action history and appeals bound to the caller", () => {
    controller.accountActionHistory(user);
    controller.createAccountActionAppeal(user, "action-1", {
      statement: "我认为该处置依据不完整，请重新核验。"
    });

    expect(accountActions.listMy).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ page: 1, pageSize: 50 })
    );
    expect(accountActions.createAppeal).toHaveBeenCalledWith(
      "user-1",
      "action-1",
      { statement: "我认为该处置依据不完整，请重新核验。" }
    );
  });
});

describe("AccountGovernanceAdminController permissions", () => {
  const governance = {
    listDataRightsForAdmin: jest.fn(),
    listClaimableDataRights: jest.fn(),
    claimDataRightsRequest: jest.fn(),
    transitionDataRightsRequest: jest.fn()
  };
  const accountActions = {
    listAdmin: jest.fn(),
    claim: jest.fn(),
    assign: jest.fn(),
    resolve: jest.fn()
  };
  const controller = new AccountGovernanceAdminController(
    governance as unknown as AccountGovernanceService,
    accountActions as any
  );

  beforeEach(() => jest.clearAllMocks());

  it("separates support data-rights work from finance invoice work", () => {
    const prototype = AccountGovernanceAdminController.prototype;
    expect(Reflect.getMetadata(ROLES_KEY, prototype.dataRights)).toEqual(["support", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.claimableDataRights)).toEqual(["support"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.claimDataRights)).toEqual(["support", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.transitionDataRights)).toEqual(["support", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.invoices)).toEqual(["finance", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.transitionInvoice)).toEqual(["finance", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.accountAppeals)).toEqual(["admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.claimAccountAppeal)).toEqual(["admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.assignAccountAppeal)).toEqual(["admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.resolveAccountAppeal)).toEqual(["admin"]);
  });

  it("passes actor identity and role into scoped list, claim, and transition operations", () => {
    const actor = { id: "support-1", role: "support" } as any;
    const query = { page: 1, pageSize: 50 } as any;
    const transition = {
      expectedStatus: "submitted",
      nextStatus: "inReview",
      reason: "开始核验"
    } as any;

    controller.dataRights(actor, query);
    controller.claimableDataRights(query);
    controller.claimDataRights(actor, "rights-1");
    controller.transitionDataRights(actor, "rights-1", transition);

    expect(governance.listDataRightsForAdmin).toHaveBeenCalledWith(
      "support-1",
      "support",
      query
    );
    expect(governance.listClaimableDataRights).toHaveBeenCalledWith(query);
    expect(governance.claimDataRightsRequest).toHaveBeenCalledWith(
      "support-1",
      "support",
      "rights-1"
    );
    expect(governance.transitionDataRightsRequest).toHaveBeenCalledWith(
      "support-1",
      "support",
      "rights-1",
      transition
    );
  });

  it("binds account-appeal queue mutations to the authenticated administrator", () => {
    const actor = { id: "admin-2", role: "admin" } as any;
    const query = { status: "pending", page: 2, pageSize: 25 } as any;
    const assignment = { assignedToUserId: "d50fb824-a1c6-4dc6-9e36-8fbd0ee3a760" };
    const resolution = { status: "overturned", resolution: "复核后确认原处置证据不足，撤销原决定。" } as any;

    controller.accountAppeals(actor, query);
    controller.claimAccountAppeal(actor, "appeal-1");
    controller.assignAccountAppeal(actor, "appeal-1", assignment);
    controller.resolveAccountAppeal(actor, "appeal-1", resolution);

    expect(accountActions.listAdmin).toHaveBeenCalledWith("admin-2", query);
    expect(accountActions.claim).toHaveBeenCalledWith("admin-2", "appeal-1");
    expect(accountActions.assign).toHaveBeenCalledWith("admin-2", "appeal-1", assignment);
    expect(accountActions.resolve).toHaveBeenCalledWith("admin-2", "appeal-1", resolution);
  });
});
