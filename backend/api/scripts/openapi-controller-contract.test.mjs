import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import yaml from "js-yaml";
import ts from "typescript";

const HTTP_DECORATORS = new Map([
  ["Get", "get"],
  ["Post", "post"],
  ["Put", "put"],
  ["Patch", "patch"],
  ["Delete", "delete"]
]);
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204
};

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith(".controller.ts") ? [target] : [];
  }));
  return nested.flat();
}

function decorators(node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function decoratorCall(node, expectedName) {
  for (const decorator of decorators(node)) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)) continue;
    const called = expression.expression;
    if (ts.isIdentifier(called) && called.text === expectedName) return expression;
  }
  return null;
}

function literalArgument(call) {
  const argument = call?.arguments[0];
  if (!argument) return "";
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text;
  }
  throw new Error(`Route decorator argument must be a static string: ${argument.getText()}`);
}

function routePath(controllerPath, methodPath) {
  const joined = [controllerPath, methodPath]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `/${joined}`
    .replace(/\/+/g, "/")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function explicitStatus(method) {
  const call = decoratorCall(method, "HttpCode");
  if (!call) return null;
  const argument = call.arguments[0];
  if (ts.isNumericLiteral(argument)) return Number(argument.text);
  if (
    ts.isPropertyAccessExpression(argument)
    && ts.isIdentifier(argument.expression)
    && argument.expression.text === "HttpStatus"
  ) {
    const value = HTTP_STATUS[argument.name.text];
    if (value) return value;
  }
  throw new Error(`Unsupported @HttpCode expression: ${argument.getText()}`);
}

async function controllerOperations() {
  const files = await sourceFiles(path.resolve("src"));
  const operations = [];
  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      const controller = decoratorCall(statement, "Controller");
      if (!controller) continue;
      const controllerPath = literalArgument(controller);
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        for (const [decoratorName, httpMethod] of HTTP_DECORATORS) {
          const route = decoratorCall(member, decoratorName);
          if (!route) continue;
          const status = explicitStatus(member) ?? (httpMethod === "post" ? 201 : 200);
          operations.push({
            path: routePath(controllerPath, literalArgument(route)),
            method: httpMethod,
            status,
            source: `${path.relative(process.cwd(), file)}:${source.getLineAndCharacterOfPosition(member.getStart()).line + 1}`
          });
        }
      }
    }
  }
  return operations;
}

function openApiOperations(document) {
  const operations = [];
  for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_DECORATORS.values()) {
      if (pathItem?.[method]) operations.push({ path: route, method, operation: pathItem[method] });
    }
  }
  return operations;
}

function resolveLocalRef(document, reference) {
  let current = document;
  for (const rawPart of reference.slice(2).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    current = current?.[part];
  }
  return current;
}

test("OpenAPI covers every Nest route and its actual success status", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const controllers = await controllerOperations();
  const contract = openApiOperations(document);
  const controllerKeys = new Map(controllers.map((item) => [`${item.method} ${item.path}`, item]));
  const contractKeys = new Map(contract.map((item) => [`${item.method} ${item.path}`, item]));
  const errors = [];

  for (const [key, controller] of controllerKeys) {
    const declared = contractKeys.get(key);
    if (!declared) {
      errors.push(`missing OpenAPI operation: ${key} (${controller.source})`);
      continue;
    }
    if (!Object.hasOwn(declared.operation.responses ?? {}, String(controller.status))) {
      errors.push(
        `success status drift: ${key} is ${controller.status} in ${controller.source}, `
        + `declared [${Object.keys(declared.operation.responses ?? {}).join(", ")}]`
      );
    }
  }
  for (const key of contractKeys.keys()) {
    if (!controllerKeys.has(key)) errors.push(`OpenAPI operation has no Nest route: ${key}`);
  }

  assert.equal(errors.length, 0, errors.join("\n"));
});

test("OpenAPI operation ids and local references remain resolvable", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const operations = openApiOperations(document);
  const ids = operations.map((item) => item.operation.operationId);
  assert.ok(ids.every(Boolean), "Every operation must have an operationId");
  assert.equal(new Set(ids).size, ids.length, "operationId values must be unique");

  const unresolved = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) {
      if (resolveLocalRef(document, value.$ref) === undefined) unresolved.push(value.$ref);
    }
    Object.values(value).forEach(visit);
  };
  visit(document);
  assert.deepEqual([...new Set(unresolved)], []);
});

test("refund review and account deletion list contracts declare bounded pagination", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const refundOperation = document.paths["/payments/refunds/review-queue"].get;
  const deletionOperation = document.paths["/admin/account-deletions"].get;
  const refundParameters = refundOperation.parameters.map((parameter) =>
    parameter.$ref ? resolveLocalRef(document, parameter.$ref) : parameter
  );

  expectParameter(refundParameters, "page", 1);
  expectParameter(refundParameters, "pageSize", 100);
  expectParameter(deletionOperation.parameters, "page", 1);
  expectParameter(deletionOperation.parameters, "pageSize", 100);
  assert.equal(
    refundOperation.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/RefundReviewQueueEnvelope"
  );
  assert.equal(
    deletionOperation.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/AccountDeletionListEnvelope"
  );
  assert.deepEqual(document.components.schemas.BoundedPagination.required, [
    "page",
    "pageSize",
    "total",
    "totalPages"
  ]);
});

test("review and commercial staff directories declare strict bounded search contracts", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const activeReviewers = document.paths["/review/staff"].get;
  const offboarding = document.paths["/review/staff/offboarding"].get;
  const commercialStaff = document.paths["/admin/staff"].get;
  const successors = document.paths["/admin/staff/eligible-successors"].get;

  for (const operation of [activeReviewers, offboarding, commercialStaff, successors]) {
    expectParameter(operation.parameters, "page", 1);
    expectParameter(operation.parameters, "pageSize", 100);
  }
  for (const operation of [activeReviewers, offboarding, commercialStaff]) {
    assert.ok(operation.parameters.some((parameter) => parameter.name === "keyword"));
    assert.ok(operation.parameters.some((parameter) => parameter.name === "role"));
  }
  assert.equal(
    activeReviewers.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/ActiveReviewStaffListEnvelope"
  );
  assert.equal(
    offboarding.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/ReviewStaffOffboardingListEnvelope"
  );
  assert.equal(
    successors.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/CommercialStaffHandoffCandidateListEnvelope"
  );
  assert.deepEqual(
    document.components.schemas.ReviewStaffOffboardingListEnvelope.allOf[1]
      .properties.data.required,
    ["items", "activeLeadCount", "pagination"]
  );
});

test("companion appeal contract declares bounded pagination and a typed queue", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const operation = document.paths["/admin/commercial/companion-lifecycle/appeals"].get;
  const parameters = operation.parameters.map((parameter) =>
    parameter.$ref ? resolveLocalRef(document, parameter.$ref) : parameter
  );

  expectParameter(parameters, "page", 1);
  expectParameter(parameters, "pageSize", 100);
  assert.equal(
    operation.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/CompanionAppealQueueEnvelope"
  );
  assert.deepEqual(
    document.components.schemas.CompanionAppealQueueEnvelope.allOf[1].properties.data.required,
    ["items", "pagination"]
  );
});

test("account deletion contracts expose the caller status and versioned SLA facts", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const route = document.paths["/me/deletion-request"];
  const cancellation = document.paths["/me/deletion-request/cancel"].post;

  assert.equal(route.get.operationId, "getMyDeletionRequest");
  assert.equal(
    route.get.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/AccountDeletionStatusEnvelope"
  );
  assert.equal(
    route.post.responses["201"].content["application/json"].schema.$ref,
    "#/components/schemas/AccountDeletionSubmissionEnvelope"
  );
  assert.equal(cancellation.operationId, "cancelMyDeletionRequest");
  assert.equal(
    cancellation.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/AccountDeletionCancellationEnvelope"
  );
  assert.deepEqual(document.components.schemas.AccountDeletionPolicy.required, [
    "version",
    "businessDays",
    "timezone",
    "calendarRule",
    "holidayNotice"
  ]);
  for (const field of [
    "dueAt",
    "policyVersion",
    "overdue",
    "cancelledAt",
    "companionReactivationRequired"
  ]) {
    assert.ok(
      document.components.schemas.AccountDeletionRequest.required.includes(field),
      `admin deletion request is missing ${field}`
    );
    assert.ok(
      document.components.schemas.AccountDeletionUserStatus.required.includes(field),
      `caller deletion status is missing ${field}`
    );
  }
  assert.ok(document.components.schemas.AccountDeletionUserStatus.required.includes("canCancel"));
  assert.deepEqual(
    document.components.schemas.AccountDeletionCancellation.properties.cancellation.properties
      .companionSupply.properties.automaticRestore.enum,
    [false]
  );
  assert.equal(
    document.components.schemas.AccountDeletionCompletionEnvelope
      .allOf[1].properties.data.$ref,
    "#/components/schemas/AccountDeletionRequest"
  );
  assert.equal(
    document.paths["/admin/account-deletions/{id}/complete"].post
      .responses["202"].content["application/json"].schema.$ref,
    "#/components/schemas/AccountDeletionCompletionEnvelope"
  );
  assert.equal(
    document.paths["/admin/account-deletions/{id}/retry"].post
      .responses["202"].content["application/json"].schema.$ref,
    "#/components/schemas/AccountDeletionCompletionEnvelope"
  );
  for (const field of [
    "status",
    "phase",
    "cursor",
    "attemptCount",
    "failureCount",
    "processedCount",
    "nextAttemptAt",
    "lastErrorCode",
    "failedAt",
    "startedAt",
    "finishedAt"
  ]) {
    assert.ok(
      document.components.schemas.AccountDeletionExecution.required.includes(field),
      `account deletion execution is missing ${field}`
    );
  }
});

test("consumer login declares generic identity-unavailable and key-coverage failures", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  for (const path of ["/auth/phone/login", "/auth/apple", "/auth/wechat/mini-program"]) {
    const responses = document.paths[path].post.responses;
    assert.equal(responses["409"].$ref, "#/components/responses/LoginIdentityUnavailable");
    assert.equal(responses["503"].$ref, "#/components/responses/Error");
  }
  const unavailable = document.components.schemas.LoginIdentityUnavailableErrorEnvelope;
  assert.equal(unavailable.additionalProperties, false);
  assert.equal(unavailable.properties.error.additionalProperties, false);
  assert.equal("details" in unavailable.properties.error.properties, false);
  assert.deepEqual(unavailable.properties.error.properties.code.enum, ["LOGIN_IDENTITY_UNAVAILABLE"]);
  assert.equal(
    document.paths["/auth/refresh"].post.responses["401"].$ref,
    "#/components/responses/Error"
  );
});

test("commercial readiness contract exposes notification, reminder, appeal, and retention blockers", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const readiness = document.paths["/admin/commercial/readiness"].get;
  const blockers = document.components.schemas.CommercialReadinessBlockers;

  assert.equal(
    readiness.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/CommercialReadinessEnvelope"
  );
  for (const field of ["overdueUserAccountAppeals", "overdueCompanionAccountAppeals", "overdueCompanionRemediationTasks"]) {
    assert.ok(blockers.required.includes(field), `readiness blockers are missing required field ${field}`);
    assert.equal(blockers.properties[field].type, "integer");
    assert.equal(blockers.properties[field].minimum, 0);
  }
  assert.ok(blockers.required.includes("accountDeletionRetentionPolicyUnapproved"));
  assert.equal(blockers.properties.accountDeletionRetentionPolicyUnapproved.minimum, 0);
  assert.equal(blockers.properties.accountDeletionRetentionPolicyUnapproved.maximum, 1);
  assert.ok(blockers.required.includes("accountDeletionRetentionApprovalBacklog"));
  assert.equal(blockers.properties.accountDeletionRetentionApprovalBacklog.type, "integer");
  assert.equal(blockers.properties.accountDeletionRetentionApprovalBacklog.minimum, 0);
  for (const field of [
    "accountDeletionAuthTombstoneCoverageGaps",
    "accountDeletionAuthTombstoneUnknownKeys"
  ]) {
    assert.ok(blockers.required.includes(field), `readiness blockers are missing required field ${field}`);
    assert.equal(blockers.properties[field].type, "integer");
    assert.equal(blockers.properties[field].minimum, 0);
  }
  for (const field of [
    "notificationDeliveryDisabledWithPending",
    "notificationDeliveryOverduePending",
    "accountDeletionExecutionFailed",
    "accountDeletionExecutionExpiredLeases",
    "accountDeletionExecutionBacklogSlaBreached",
    "availabilityReminderFanoutFailed",
    "availabilityReminderFanoutExpiredLeases",
    "availabilityReminderFanoutBacklogSlaBreached",
    "availabilityReminderFanoutRunnerDisabledWithDueBacklog",
    "availabilityReminderPreparationFailures",
    "availabilityReminderReservationFailures",
    "availabilityReminderDeliveryFailures",
    "availabilityReminderPreparationExpiredLeases",
    "availabilityReminderReservationExpiredLeases",
    "availabilityReminderDeliveryClaimExpiredLeases",
    "availabilityReminderAttemptExpiredLeases",
    "availabilityReminderPipelineBacklogSlaBreached",
    "availabilityReminderPreparationRunnerDisabledWithDueBacklog",
    "availabilityReminderDeliveryRunnerDisabledWithDueBacklog",
    "availabilityReminderTerminalUnresolved"
  ]) {
    assert.ok(blockers.required.includes(field), `readiness blockers are missing required field ${field}`);
    assert.equal(blockers.properties[field].type, "integer");
    assert.equal(blockers.properties[field].minimum, 0);
  }
  const notification = document.components.schemas.CommercialNotificationDeliveryReadiness;
  assert.equal(
    document.components.schemas.CommercialReadiness.properties.notificationDelivery.$ref,
    "#/components/schemas/CommercialNotificationDeliveryReadiness"
  );
  for (const field of [
    "enabled",
    "intervalSeconds",
    "slaSeconds",
    "pendingTotal",
    "duePending",
    "overduePending",
    "oldestDueAt",
    "oldestDueAgeSeconds",
    "processing",
    "expiredProcessing",
    "unreadFailed"
  ]) {
    assert.ok(notification.required.includes(field), `notification readiness is missing ${field}`);
  }
  assert.equal(notification.properties.slaSeconds.minimum, 120);
  const deletionExecution = document.components.schemas.CommercialAccountDeletionExecutionReadiness;
  assert.equal(
    document.components.schemas.CommercialReadiness.properties.accountDeletionExecution.$ref,
    "#/components/schemas/CommercialAccountDeletionExecutionReadiness"
  );
  for (const field of [
    "dueBacklog",
    "processing",
    "failed",
    "expiredLeases",
    "oldestDueAt",
    "oldestDueAgeSeconds",
    "backlogSlaSeconds",
    "backlogSlaBreached"
  ]) {
    assert.ok(deletionExecution.required.includes(field), `deletion execution readiness is missing ${field}`);
  }
  assert.equal(deletionExecution.properties.backlogSlaSeconds.enum[0], 300);
  const authTombstones = document.components.schemas.CommercialAccountDeletionAuthTombstoneReadiness;
  assert.equal(
    document.components.schemas.CommercialReadiness.properties.accountDeletionAuthTombstones.$ref,
    "#/components/schemas/CommercialAccountDeletionAuthTombstoneReadiness"
  );
  assert.deepEqual(authTombstones.required, [
    "coverageGaps",
    "unknownKeyBacklog",
    "expiredCleanupBacklog",
    "configuredKeyIds"
  ]);
  assert.equal(
    document.components.schemas.CommercialReadiness.properties.availabilityReminder.$ref,
    "#/components/schemas/AvailabilityReminderFanoutReadiness"
  );
  const reminderPipeline = document.components.schemas.AvailabilityReminderFanoutReadiness
    .properties.pipeline;
  for (const field of [
    "dueCandidates",
    "expiredPreparationLeases",
    "dueReservations",
    "expiredReservationLeases",
    "dueAttempts",
    "expiredDeliveryClaimLeases",
    "preparationRunnerDisabledWithDueBacklog",
    "deliveryRunnerDisabledWithDueBacklog"
  ]) {
    assert.ok(reminderPipeline.required.includes(field), `reminder pipeline readiness is missing ${field}`);
  }
});

test("WeChat reconciliation contract exposes full coverage, provider-time, and two-person evidence gates", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const gate = document.components.schemas.WeChatReconciliationGate;
  const issue = document.components.schemas.WeChatPaymentReconciliationIssue;
  const kinds = document.components.schemas.WeChatReconciliationIssueKind.enum;
  const proposal = document.components.schemas.SubmitWeChatReconciliationResolutionInput;

  assert.ok(document.paths["/admin/commercial/payment-reconciliation/issues/{id}/resolution-reviews"].post);
  for (const field of [
    "configuredStartDate",
    "providerCatchupStartDate",
    "requiredRuns",
    "missingOrIncompleteRuns",
    "unresolvedIssues",
    "pendingApprovals",
    "pendingBillImportApprovals",
    "unclassifiedCashLedgerEntries",
    "unknownProviderPaymentTimes",
    "unknownProviderRefundTimes"
  ]) {
    assert.ok(gate.required.includes(field), `reconciliation gate is missing ${field}`);
  }
  for (const field of ["canSubmitResolution", "canApproveResolution", "canRejectResolution"]) {
    assert.ok(issue.required.includes(field), `actor-aware issue response is missing ${field}`);
  }
  for (const kind of [
    "localPaymentSuccessProviderNotPaid",
    "providerRefundedLocalUnsettled",
    "providerFundBusinessTypeUnreviewed",
    "providerFundAmountNotLocallyVerifiable",
    "localPaymentMissingProviderFundBill",
    "localRefundMissingProviderFundBill"
  ]) {
    assert.ok(kinds.includes(kind), `reconciliation issue vocabulary is missing ${kind}`);
  }
  assert.ok(proposal.required.includes("evidenceReference"));
  assert.equal(proposal.properties.evidenceDigestSha256.pattern, "^[a-fA-F0-9]{64}$");
});

test("finance terminal controls declare all eight bounded and typed operations", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const expectedOperations = new Map([
    ["get /admin/commercial/payment-reconciliation/merchant-imports", "adminListWeChatMerchantBillImports"],
    ["post /admin/commercial/payment-reconciliation/merchant-imports", "adminSubmitWeChatMerchantBillImport"],
    ["post /admin/commercial/payment-reconciliation/merchant-imports/text", "adminSubmitWeChatMerchantBillTextImport"],
    ["post /admin/commercial/payment-reconciliation/merchant-imports/{id}/reviews", "adminReviewWeChatMerchantBillImport"],
    ["get /admin/commercial/payment-reconciliation/cash-ledger", "adminListWeChatCashLedgerEntries"],
    ["post /admin/commercial/payment-reconciliation/cash-ledger/{id}/classifications", "adminSubmitCashLedgerClassification"],
    ["post /admin/commercial/payment-reconciliation/cash-ledger/classifications/{id}/reviews", "adminReviewCashLedgerClassification"],
    ["get /admin/commercial/payment-disputes/{id}/evidence/{resource}", "adminListPaymentDisputeEvidence"]
  ]);

  for (const [key, operationId] of expectedOperations) {
    const [method, route] = key.split(" ");
    assert.equal(document.paths[route]?.[method]?.operationId, operationId, `missing finance operation ${key}`);
  }

  for (const route of [
    "/admin/commercial/payment-reconciliation/merchant-imports",
    "/admin/commercial/payment-reconciliation/cash-ledger"
  ]) {
    expectParameter(document.paths[route].get.parameters, "page", 1);
    expectParameter(document.paths[route].get.parameters, "pageSize", 100);
  }

  const jsonImport = document.paths["/admin/commercial/payment-reconciliation/merchant-imports"].post;
  const textImport = document.paths["/admin/commercial/payment-reconciliation/merchant-imports/text"].post;
  assert.match(jsonImport.description, /90-day window/);
  assert.match(jsonImport.description, /five-year history window/);
  assert.equal(textImport.requestBody.content["text/plain"].schema.maxLength, 20 * 1024 * 1024);
  assert.equal(textImport.requestBody.content["text/csv"].schema.maxLength, 20 * 1024 * 1024);
  assert.equal(document.components.schemas.WeChatMerchantBillImport.properties.rawContentPersisted.enum[0], false);
  assert.equal(document.components.schemas.WeChatMerchantBillImport.properties.content, undefined);
  assert.equal(document.components.schemas.CashLedgerEntry.properties.bookedAt.nullable, undefined);
  assert.ok(document.components.schemas.CashLedgerEntry.required.includes("bookedAt"));

  const evidenceOperation = document.paths["/admin/commercial/payment-disputes/{id}/evidence/{resource}"].get;
  const resourceParameter = evidenceOperation.parameters.find((parameter) => parameter.name === "resource");
  assert.deepEqual(resourceParameter.schema.enum, [
    "notifications",
    "replies",
    "attachments",
    "negotiation-events",
    "complaint-orders",
    "recoveries"
  ]);
  expectParameter(evidenceOperation.parameters, "page", 1);
  expectParameter(evidenceOperation.parameters, "pageSize", 100);
  const evidenceVariants = document.components.schemas.PaymentDisputeEvidencePageEnvelope
    .allOf[1].properties.data.properties.items.items.oneOf.map((item) => item.$ref);
  assert.deepEqual(evidenceVariants, [
    "#/components/schemas/PaymentDisputeNotificationEvidence",
    "#/components/schemas/PaymentDisputeReplyEvidence",
    "#/components/schemas/PaymentDisputeAttachmentEvidence",
    "#/components/schemas/PaymentDisputeNegotiationEvidence",
    "#/components/schemas/PaymentDisputeComplaintOrderEvidence",
    "#/components/schemas/PaymentDisputeRecoveryEvidence"
  ]);
  for (const field of ["ownedOrderIds", "ownedOrders"]) {
    assert.ok(document.components.schemas.PaymentDisputeUserView.required.includes(field));
  }
  assert.ok(!document.components.schemas.WeChatReconciliationIssueKind.enum.includes(
    "localRefundSuccessProviderNotRefunded"
  ));
});

test("ordinary-user account actions require private immutable evidence without leaking it publicly", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const operation = document.paths["/admin/users/{id}/account-status"].patch;
  const variants = operation.requestBody.content["application/json"].schema.oneOf;
  const actionVariant = variants.find((candidate) =>
    candidate.properties.status.enum.includes("restricted")
  );
  const restorationVariant = variants.find((candidate) =>
    candidate.properties.status.enum.includes("active")
  );

  for (const field of ["sourceType", "sourceReference", "evidenceReference"]) {
    assert.ok(actionVariant.required.includes(field), `new account actions must require ${field}`);
  }
  assert.deepEqual(restorationVariant.properties.sourceType.enum, ["userAccountAction"]);
  assert.equal(
    document.paths["/admin/account-governance/account-appeals"].get.responses["200"]
      .content["application/json"].schema.$ref,
    "#/components/schemas/UserAccountAppealQueueEnvelope"
  );

  const publicAction = document.components.schemas.UserAccountAction;
  for (const privateField of [
    "sourceType",
    "sourceReference",
    "evidenceReference",
    "evidenceDigest",
    "evidenceAnonymizedAt"
  ]) {
    assert.equal(publicAction.properties[privateField], undefined);
  }
  const reviewEvidence = document.components.schemas.UserAccountActionEvidenceReview;
  assert.equal(reviewEvidence.properties.evidenceDigest.pattern, "^[a-f0-9]{64}$");
  assert.ok(reviewEvidence.properties.status.enum.includes("anonymized"));
});

test("future-booking boundaries are companion-owned, reason-free and existing-record safe", async () => {
  const document = yaml.load(await readFile("../../shared/contracts/openapi/v1.yaml", "utf8"));
  const operation = document.paths["/conversations/{id}/future-booking-boundary"].put;
  const input = operation.requestBody.content["application/json"].schema;
  const output = operation.responses["200"].content["application/json"].schema
    .allOf[1].properties.data;
  const status = document.paths["/conversations/{id}/status"].get.responses["200"]
    .content["application/json"].schema.allOf[1].properties.data;

  assert.equal(operation.operationId, "setConversationFutureBookingBoundary");
  assert.deepEqual(input.required, ["declined"]);
  assert.deepEqual(Object.keys(input.properties), ["declined"]);
  assert.equal(input.additionalProperties, false);
  for (const forbidden of ["reason", "reasonCode", "customerUserId", "boundaryId"]) {
    assert.equal(output.properties[forbidden], undefined);
  }
  assert.equal(output.properties.futureBookingBoundaryScope.enum[0], "newOrdersAndRecommendationsOnly");
  assert.equal(output.properties.existingOrdersUnaffected.enum[0], true);
  assert.equal(output.properties.conversationUnaffected.enum[0], true);
  assert.equal(status.properties.futureBookingsDeclinedByYou.type, "boolean");
  assert.match(status.properties.futureBookingsDeclinedByYou.description, /Customers always receive false/);
});

function expectParameter(parameters, name, expectedMaximum) {
  const parameter = parameters.find((candidate) => candidate.name === name);
  assert.ok(parameter, `missing ${name} query parameter`);
  assert.equal(parameter.schema.minimum, 1);
  if (name === "pageSize") assert.equal(parameter.schema.maximum, expectedMaximum);
}
