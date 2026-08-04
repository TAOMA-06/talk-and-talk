import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminHtml, adminScript, reviewHtml, reviewScript, mainSource] = await Promise.all([
  readFile("public/admin/index.html", "utf8"),
  readFile("public/admin/assets/app.js", "utf8"),
  readFile("public/review/index.html", "utf8"),
  readFile("public/review/assets/app.js", "utf8"),
  readFile("src/main.ts", "utf8")
]);

function assertNoInlineExecutableHtml(html, label) {
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc\s*=)[^>]*>/i, `${label} must not contain inline scripts`);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${label} must not contain inline event handlers`);
  assert.doesNotMatch(html, /javascript\s*:/i, `${label} must not contain javascript: URLs`);
}

test("admin and review static applications preserve separate identity domains", () => {
  assert.match(adminScript, /\/auth\/staff\/login/);
  assert.doesNotMatch(adminScript, /\/review\/auth\/login/);
  assert.match(reviewScript, /\/api\/v1\/review\/auth\/login/);
  assert.doesNotMatch(reviewScript, /\/auth\/staff\/login/);
  assert.match(mainSource, /router\.get\("\/admin\/"/);
  assert.match(mainSource, /join\(publicRoot,\s*"admin",\s*"index\.html"\)/);
  assert.match(mainSource, /router\.get\("\/review\/"/);
  assert.match(mainSource, /join\(publicRoot,\s*"review",\s*"index\.html"\)/);
});

test("static HTML is compatible with the same-origin script CSP", () => {
  assertNoInlineExecutableHtml(adminHtml, "admin");
  assertNoInlineExecutableHtml(reviewHtml, "review");
  assert.match(mainSource, /scriptSrc:\s*\["'self'"\]/);
  assert.match(adminHtml, /<script src="\/admin\/assets\/app\.js" defer><\/script>/);
  assert.match(reviewHtml, /<script src="\/review\/assets\/app\.js" defer><\/script>/);
});

test("commercial admin exposes real queues and controlled mutation safeguards", () => {
  for (const endpoint of [
    "/admin/commercial/readiness",
    "/admin/recommendations/metrics",
    "/admin/recommendations/companions/${encodeURIComponent(companionId)}/policies/${encodeURIComponent(placement)}",
    "/admin/commercial/availability-reminders/readiness",
    "/admin/commercial/availability-reminders/${encodeURIComponent(stage)}/${encodeURIComponent(id)}/retry",
    "/admin/commercial/availability-reminders/terminal-attempts/${encodeURIComponent(id)}/resolve",
    "/admin/commercial/funnel",
    "/admin/operations/orders",
    "/admin/operations/support/orders",
    "/admin/commercial/support/tickets",
    "/admin/commercial/support/claimable",
    "/admin/commercial/support/tickets/${encodeURIComponent(item.id)}/claim",
    "/admin/commercial/attendance-disputes?",
    "/admin/commercial/attendance-disputes/claimable?",
    "/admin/commercial/attendance-disputes/${encodeURIComponent(item.id)}/claims",
    "/admin/commercial/attendance-disputes/${encodeURIComponent(item.id)}/appeal-claims",
    "/admin/commercial/payment-disputes?",
    "/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/claims",
    "/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/assignments",
    "/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/replies",
    "/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/completions",
    "/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/sync",
    "/admin/commercial/payment-disputes/${encodeURIComponent(id)}/evidence/${encodeURIComponent(resource)}?",
    "/admin/commercial/payment-reconciliation/readiness",
    "/admin/commercial/payment-reconciliation/merchant-imports?",
    "/admin/commercial/payment-reconciliation/merchant-imports/text",
    "/admin/commercial/payment-reconciliation/merchant-imports/${encodeURIComponent(item.id)}/reviews",
    "/admin/commercial/payment-reconciliation/cash-ledger?",
    "/admin/commercial/payment-reconciliation/cash-ledger/${encodeURIComponent(item.id)}/classifications",
    "/admin/commercial/payment-reconciliation/cash-ledger/classifications/${encodeURIComponent(proposal.id)}/reviews",
    "/admin/commercial/payment-reconciliation/runs?",
    "/admin/commercial/payment-reconciliation/issues?",
    "/admin/commercial/payment-reconciliation/runs/${encodeURIComponent(item.id)}/retry",
    "/admin/commercial/payment-reconciliation/issues/${encodeURIComponent(item.id)}/claims",
    "/admin/commercial/payment-reconciliation/issues/${encodeURIComponent(item.id)}/resolutions",
    "/payments/refunds/review-queue",
    "/admin/commercial/earnings",
    "/admin/commercial/companion-lifecycle/training",
    "/admin/commercial/companion-lifecycle/review-due",
    "/admin/commercial/companion-lifecycle/actions",
    "/admin/commercial/companion-lifecycle/companions/${encodeURIComponent(companionId)}/voice-intro-read",
    "/admin/users/${encodeURIComponent(item.ownerUserId)}/verification",
    "/admin/identity-verification-requests?status=",
    "/admin/identity-verification-requests/${encodeURIComponent(item.id)}/${decision}",
    "/admin/account-governance/data-rights",
    "/admin/account-governance/data-rights/claimable",
    "/admin/account-governance/data-rights/${encodeURIComponent(item.id)}/claim",
    "/admin/account-governance/invoice-requests",
    "/admin/account-deletions",
    "/admin/operations/audit-logs"
  ]) {
    assert.ok(adminScript.includes(endpoint), `admin must call ${endpoint}`);
  }
  assert.match(adminHtml, /id="controlledModeButton"/);
  assert.match(adminHtml, /data-view-target="growth"/);
  assert.match(adminHtml, /id="recommendationPolicyForm"/);
  assert.match(adminHtml, /id="availabilityReminderReadiness"/);
  assert.match(adminHtml, /id="availabilityReminderTerminalForm"/);
  assert.match(adminHtml, /渠道结果不确定（uncertain）必须人工核对/);
  assert.match(adminHtml, /automaticResend 始终为 false/);
  assert.match(adminHtml, /id="actionReason"/);
  assert.match(adminHtml, /id="actionConfirmation"/);
  assert.match(adminScript, /mutationsEnabled:\s*false/);
  assert.match(adminScript, /X-Admin-Action-Reason/);
  assert.match(adminScript, /X-Admin-Operation-Id/);
  assert.match(adminScript, /reasonMinLength:\s*8/);
  assert.match(adminScript, /loadGrowth/);
  assert.match(adminScript, /failedBeforeSend/);
  assert.match(adminScript, /pipeline\.uncertain/);
  assert.match(adminScript, /terminalAttempts\.unresolved/);
  assert.match(adminScript, /uncertainProviderStateReconciled/);
  assert.match(adminScript, /result\.automaticResend === false/);
  assert.match(adminScript, /reviewedAssetReference/);
  assert.match(adminScript, /viewCapabilities/);
  assert.match(adminScript, /canAccessView/);
  assert.match(adminScript, /expectedStatus:\s*item\.status/);
  assert.match(adminScript, /data-rights\.manage/);
  assert.match(adminScript, /data-rights\.assigned\.manage/);
  assert.match(adminScript, /data-rights\.claimable-summary\.read/);
  assert.match(adminScript, /invoice\.manage/);
  assert.match(adminScript, /companion\.lifecycle\.supply\.manage/);
  assert.match(adminScript, /companion\.withdrawal\.manage/);
  assert.match(adminScript, /allowedConfigs = configs\.filter/);
  assert.match(adminScript, /support\.ticket\.claimable-summary\.read/);
  assert.match(adminScript, /support\.order\.assigned\.read/);
  assert.match(adminScript, /payment-dispute\.queue\.read/);
  assert.match(adminScript, /payment-dispute\.financial\.read/);
  assert.match(adminScript, /payment-dispute\.all\.read/);
  assert.match(adminScript, /item\.negotiationEvents/);
  assert.match(adminHtml, /id="paymentDisputeStatusFilter"/);
  assert.match(adminScript, /order\.read\.operational-redacted/);
  assert.match(adminScript, /canAssignAny/);
  assert.match(adminScript, /activeSupportTicketCount/);
  assert.match(adminScript, /item\.submittedBy\?\.id === state\.user\?\.id/);
  assert.match(adminScript, /const ownerIsVerified = item\.owner\?\.isVerified === true/);
  assert.match(adminScript, /const next = !\(item\.owner\?\.isVerified === true\)/);
  assert.match(adminScript, /item\.isVerified \? "资料已核验" : "资料未核验"/);
  assert.match(adminScript, /不会立即改变实名状态/);
  assert.match(adminScript, /批准后服务端才会应用实名状态/);
  assert.match(adminScript, /resolutionEvidenceReference/);
  assert.match(adminScript, /evidenceReference/);
  assert.match(adminHtml, /id="identityVerificationStatusFilter"/);
  assert.match(adminHtml, /id="attendanceDisputeStatusFilter"/);
  assert.match(adminHtml, /不录音，渠道事件优先/);
  assert.match(adminScript, /客户端辅助事件不能单独作为结论/);
  assert.match(adminScript, /INDEPENDENT FINAL REVIEW/);
  assert.match(adminScript, /尚未确认渠道成功/);
  assert.match(adminHtml, /提交不等于生效/);
  assert.match(adminHtml, /id="dataRightsStatusFilter"/);
  assert.match(adminHtml, /id="invoiceStatusFilter"/);
  assert.match(adminHtml, /本后台不生成票据、下载链接或伪造事实/);
  assert.match(adminHtml, /value="voided"/);
  assert.match(adminScript, /overdueUserAccountAppeals:\s*"普通用户账号申诉复核超时"/);
  assert.match(adminScript, /overdueCompanionAccountAppeals:\s*"陪伴者账号申诉复核超时"/);
  assert.match(adminScript, /accountDeletionRetentionPolicyUnapproved:\s*"账号注销保留政策未获外部法律批准"/);
  assert.match(adminScript, /accountDeletionRetentionApprovalBacklog:\s*"账号注销保留分类待法律批准入账"/);
  for (const blocker of [
    "notificationDeliveryDisabledWithPending",
    "notificationDeliveryOverduePending",
    "accountDeletionExecutionFailed",
    "accountDeletionExecutionExpiredLeases",
    "accountDeletionExecutionBacklogSlaBreached",
    "accountDeletionAuthTombstoneCoverageGaps",
    "accountDeletionAuthTombstoneUnknownKeys",
    "availabilityReminderFanoutBacklogSlaBreached",
    "availabilityReminderPreparationFailures",
    "availabilityReminderReservationFailures",
    "availabilityReminderDeliveryFailures",
    "availabilityReminderPreparationExpiredLeases",
    "availabilityReminderReservationExpiredLeases",
    "availabilityReminderDeliveryClaimExpiredLeases",
    "availabilityReminderAttemptExpiredLeases",
    "availabilityReminderPipelineBacklogSlaBreached",
    "availabilityReminderTerminalUnresolved"
  ]) {
    assert.match(adminScript, new RegExp(`${blocker}:\\s*"`), `admin is missing label for ${blocker}`);
  }
  assert.match(adminScript, /readiness\.accountDeletionAuthTombstones/);
  assert.match(adminScript, /已配置密钥/);
  assert.match(adminScript, /ACCOUNT_ACTION_HAS_ACTIVE_COMMERCIAL_OBLIGATIONS/);
  assert.match(adminScript, /安全事件先使用聊天限制、会话拉黑或客服\/退款流程/);
  assert.match(adminScript, /error\.details = body\?\.error\?\.details/);
  assert.match(adminScript, /name: "sourceType"/);
  assert.match(adminScript, /name: "sourceReference"/);
  assert.match(adminScript, /name: "evidenceReference"/);
  assert.match(adminScript, /sourceType: "userAccountAction"/);
  assert.match(adminScript, /仅显示引用与摘要，不显示原始敏感证据/);
  assert.match(adminScript, /SHA-256/);
  assert.match(adminScript, /evidence\.status === "anonymized"/);
  assert.doesNotMatch(adminScript, /safeNavigationUrl\(assetReference\)/);
});

test("commercial growth queues paginate independently and assignee search never silently truncates", () => {
  for (const id of [
    "companionPagination",
    "supportPagination",
    "supportClaimablePagination",
    "earningPagination",
    "recoveryPagination",
    "trainingPagination",
    "reviewDuePagination",
    "accountActionPagination",
    "incidentPagination",
    "withdrawalPagination",
    "voiceIntroPagination"
  ]) {
    assert.match(adminHtml, new RegExp(`id="${id}" class="pagination"`));
  }
  assert.match(adminScript, /state\.pages\.companions = companionPage/);
  assert.match(adminScript, /assignedOnly=true&page=\$\{assignedPage\}&pageSize=50/);
  assert.match(adminScript, /support\/claimable\?page=\$\{claimablePage\}&pageSize=50/);
  assert.match(adminScript, /loadSupport\(next, state\.pages\.supportClaimable\)/);
  assert.match(adminScript, /loadSupport\(state\.pages\.supportAssigned, next\)/);
  assert.match(adminScript, /state\.pages\.earnings = earningPage/);
  assert.match(adminScript, /state\.pages\.recoveries = recoveryPage/);
  for (const pageKey of ["training", "reviewDue", "accountActions", "incidents", "withdrawals", "voiceIntros"]) {
    assert.match(adminScript, new RegExp(`page=\\$\\{state\\.pages\\.${pageKey}\\}&pageSize=50`));
  }
  assert.match(adminScript, /\/admin\/operations\/support-assignees\?keyword=/);
  assert.match(adminScript, /匹配人员超过 100 名，请补充更精确/);
  assert.doesNotMatch(adminScript, /\/admin\/operations\/users\?role=support&accountStatus=active&page=1&pageSize=100/);
  assert.match(adminScript, /Promise\.allSettled/);
  assert.match(adminScript, /renderLoadError/);
});

test("payment reconciliation workbench fails closed and exposes bounded evidence workflows", () => {
  for (const id of [
    "paymentReconciliationPanel",
    "paymentReconciliationCreateDate",
    "merchantBillImportDate",
    "merchantBillImportKind",
    "merchantBillEvidenceReference",
    "merchantBillImportFile",
    "merchantBillImportButton",
    "merchantBillImportStatus",
    "merchantBillImportList",
    "cashLedgerClassificationList"
  ]) {
    assert.match(adminHtml, new RegExp(`id="${id}"`));
  }
  for (const id of [
    "paymentReconciliationRunPagination",
    "paymentReconciliationIssuePagination",
    "merchantBillImportPagination",
    "cashLedgerClassificationPagination"
  ]) {
    assert.match(adminHtml, new RegExp(`id="${id}" class="pagination"`));
  }
  assert.match(adminHtml, /无账单不等于已核对/);
  assert.match(adminHtml, /超过 API 90 天/);
  assert.match(adminHtml, /商户平台可查 5 年且可合并最多 31 天/);
  assert.match(adminHtml, /官方 CSV（最大 20 MiB）/);
  assert.match(adminHtml, /原文仅在本次上传请求内解析，页面和数据库都不回显/);
  assert.match(adminScript, /payment-reconciliation\.manage/);
  assert.match(adminScript, /state\.pages\.paymentReconciliationRuns = runPage/);
  assert.match(adminScript, /state\.pages\.paymentReconciliationIssues = issuePage/);
  assert.match(adminScript, /Promise\.allSettled/);
  assert.match(adminScript, /item\.hashVerified/);
  assert.match(adminScript, /微信返回无账单 · 必须继续核对本地活动/);
  assert.match(adminScript, /item\.status === "failed" \|\| item\.status === "noStatement"/);
  assert.match(adminScript, /重新拉取无账单/);
  assert.match(adminScript, /账单运行记录加载失败.*状态未知，不得标记已核对/);
  assert.match(adminScript, /acceptedException/);
  assert.match(adminScript, /有证据接受例外/);
  assert.match(adminScript, /item\.canApproveResolution/);
  assert.match(adminScript, /item\.canRejectResolution/);
  assert.match(adminScript, /evidenceDigestSha256/);
  assert.match(adminScript, /resolution-reviews/);
  assert.match(adminScript, /window\.crypto\.subtle\.digest\("SHA-256", bytes\)/);
  assert.match(adminScript, /content = ""/);
  assert.match(adminScript, /fileInput\.value = ""/);
  assert.match(adminScript, /原文持久化：否/);
  assert.match(adminScript, /pendingBillImportApprovals/);
  assert.match(adminScript, /unclassifiedCashLedgerEntries/);
  assert.match(adminScript, /历史账单待复核/);
  assert.match(adminScript, /资金待分类/);
  assert.doesNotMatch(adminScript, /console\.log\(content\)/);
  assert.match(adminScript, /#paymentReconciliationRunStatusFilter"\)\.addEventListener\("change"/);
  assert.match(adminScript, /#paymentReconciliationIssueKindFilter"\)\.addEventListener\("change"/);
});

test("payment dispute workbench paginates typed evidence and blocks unmatched completion", () => {
  assert.match(adminScript, /evidenceWindows/);
  assert.match(adminScript, /data-payment-evidence-resource/);
  assert.match(adminScript, /loadPaymentDisputeEvidence/);
  assert.match(adminScript, /insertAdjacentHTML\("beforeend"/);
  assert.match(adminScript, /已经读取的证据仍保留/);
  assert.match(adminScript, /Number\(item\.unmatchedComplaintOrderCount \|\| 0\) === 0/);
  assert.match(adminScript, /投诉订单未关联本地支付，禁止完结/);
});

test("refund and account-deletion queues expose independent bounded pagination", () => {
  const refundLoader = adminScript.slice(
    adminScript.indexOf("async function loadRefunds"),
    adminScript.indexOf("async function loadPaymentDisputes")
  );
  const accountLoader = adminScript.slice(
    adminScript.indexOf("async function loadAccounts"),
    adminScript.indexOf("function renderDataRights")
  );

  assert.match(adminHtml, /id="refundStatusFilter"/);
  assert.match(adminHtml, /id="refundPagination" class="pagination"/);
  assert.match(adminHtml, /id="deletionPagination" class="pagination"/);
  assert.match(refundLoader, /state\.pages\.refunds = page/);
  assert.match(refundLoader, /page: String\(page\), pageSize: "50"/);
  assert.match(refundLoader, /renderPagination\(pagination, data\.pagination/);
  assert.match(accountLoader, /page: String\(deletionPage\), pageSize: "50"/);
  assert.match(accountLoader, /renderPagination\(\s*deletionPagination,\s*results\[1\]\.value\.pagination/);
  assert.match(adminScript, /blockingObligations\?\.clear === true/);
  assert.match(adminScript, /开始注销结算（No-Go）/);
  assert.match(adminScript, /order\.relationship !== "companion"/);
  assert.match(adminScript, /陪伴者履约侧/);
  assert.match(adminScript, /留存策略取得外部法律批准/);
  assert.match(adminScript, /批准并开始分批擦除/);
  assert.match(adminScript, /受控重试当前阶段/);
  assert.match(adminScript, /completionTruth/);
  assert.match(adminScript, /account-deletions\/\$\{encodeURIComponent\(item\.id\)\}\/retry/);
  assert.match(adminScript, /#refundStatusFilter"\)\.addEventListener\("change", \(\) => loadRefunds\(1\)\)/);
  assert.match(adminScript, /#deletionStatusFilter"\)\.addEventListener\("change", \(\) => loadAccounts\(state\.pages\.users, 1,/);
  assert.match(adminScript, /account-deletions\/\$\{encodeURIComponent\(id\)\}\/settlement\?page=\$\{page\}&pageSize=50/);
  assert.match(adminScript, /data-deletion-settlement-more/);
  assert.match(adminScript, /ordersLoadMoreError/);
  assert.match(adminScript, /mergedOrders/);
});

test("data-retention legal holds expose a policy-gated, two-person, paginated admin workbench", () => {
  assert.match(adminHtml, /id="legalHoldPanel"/);
  assert.match(adminHtml, /id="legalHoldStateFilter"/);
  assert.match(adminHtml, /id="legalHoldCategoryFilter"/);
  assert.match(adminHtml, /id="legalHoldPagination" class="pagination"/);
  assert.match(adminHtml, /id="legalHoldHistoryPagination" class="pagination"/);
  assert.match(adminScript, /state\.user\?\.role === "admin"/);
  assert.match(adminScript, /\/admin\/data-retention\/legal-hold-policy/);
  assert.match(adminScript, /\/admin\/data-retention\/records\?\$\{query\.toString\(\)\}/);
  assert.match(adminScript, /pageSize: "50"/);
  assert.match(adminScript, /legal-hold-placement-requests/);
  assert.match(adminScript, /legal-holds\/\$\{encodeURIComponent\(item\.legalHold\.id\)\}\/release-requests/);
  assert.match(adminScript, /legal-hold-actions\/\$\{encodeURIComponent\(pending\.id\)\}\/\$\{approve \? "approvals" : "rejections"\}/);
  assert.match(adminScript, /等待其他管理员复核/);
  assert.doesNotMatch(adminScript, /policyApprovalReference[^\n]*innerHTML/);
});

test("review workbench exposes assignment, SLA, evidence, and lead-only export controls", () => {
  assert.match(reviewScript, /\/cases\/\$\{encodeURIComponent\(state\.selectedCaseId\)\}\/claim/);
  assert.match(reviewScript, /\/cases\/\$\{encodeURIComponent\(state\.selectedCaseId\)\}\/assignment/);
  assert.match(reviewScript, /data-due-at/);
  assert.match(reviewScript, /message\.attachments\.map\(renderAttachment\)/);
  assert.match(reviewScript, /state\.reviewer\?\.role !== "lead"/);
  assert.match(reviewScript, /\/labels\/export/);
  assert.match(reviewHtml, /id="sessionRemaining"/);
  assert.match(reviewHtml, /id="exportLabelsButton" class="button quiet lead-only"/);
});

test("review workbench keeps mobile-safe session exit and filter reset on the real client", async () => {
  const reviewStyles = await readFile("public/review/assets/styles.css", "utf8");
  assert.match(reviewHtml, /data-review-logout/);
  assert.match(reviewHtml, /id="headerLogoutButton"/);
  assert.match(reviewHtml, /id="filterResetButton"/);
  assert.match(reviewScript, /querySelectorAll\("\[data-review-logout\]"\)/);
  assert.match(reviewScript, /#filterResetButton/);
  assert.match(reviewScript, /state\.filters = \{ page: 1, pageSize: 50 \}/);
  assert.match(reviewScript, /sessionStorage\.(setItem|getItem|removeItem)/);
  assert.doesNotMatch(reviewScript, /localStorage/);
  assert.match(reviewStyles, /:focus-visible/);
  assert.match(reviewStyles, /prefers-reduced-motion:\s*reduce/);
  assert.match(reviewStyles, /\.header-logout/);
  assert.match(reviewStyles, /\.sidebar-bottom \{ display: none/);
});

test("review staff operations search and traverse every stable directory page without clearing errors", () => {
  for (const id of [
    "staffOffboardingFilterForm",
    "staffOffboardingKeyword",
    "staffOffboardingStatus",
    "staffOffboardingRole",
    "staffOffboardingPagination",
    "staffHandoffReviewerFilterForm",
    "staffHandoffReviewerMore"
  ]) {
    assert.match(reviewHtml, new RegExp(`id="${id}"`));
  }
  assert.match(reviewScript, /status: "active",\s*page: String\(page\),\s*pageSize: String\(state\.reviewerQuery\.pageSize\)/);
  assert.match(reviewScript, /loadReviewers\(state\.reviewerPagination\.page \+ 1, true\)/);
  assert.match(reviewScript, /staff\/offboarding\?\$\{query\.toString\(\)\}/);
  assert.match(reviewScript, /loadStaffOffboarding\(Number\(button\.dataset\.staffPage/);
  assert.match(reviewScript, /已保留上次成功读取的目录/);
  assert.match(reviewScript, /已保留当前 \$\{state\.reviewers\.length\} 项/);
  assert.match(reviewScript, /active lead 全局总数/);
});

test("commercial staff successor selection uses a bounded endpoint and traverses every reported page", () => {
  assert.match(adminHtml, /id="staffCredentialFilterForm"/);
  assert.match(adminHtml, /id="staffCredentialKeywordFilter"/);
  assert.match(adminHtml, /id="staffCredentialRoleFilter"/);
  assert.match(adminScript, /\/admin\/staff\/eligible-successors\?\$\{query\.toString\(\)\}/);
  assert.match(adminScript, /pageSize: "100"/);
  assert.match(adminScript, /while \(page <= totalPages\)/);
  assert.match(adminScript, /避免遗漏后页/);
  assert.match(adminScript, /以下保留上次成功读取的数据，不代表当前实时状态/);
  assert.doesNotMatch(adminScript, /data\.eligibleSuccessors/);
});

test("admin and review deep links preserve opaque resource state without URL credentials", () => {
  assert.match(adminScript, /function parseAdminRoute/);
  assert.match(adminScript, /function restoreAdminRoute/);
  assert.match(adminScript, /window\.addEventListener\("popstate"/);
  assert.match(adminScript, /adminDetailKinds = new Map/);
  assert.match(adminScript, /admin\/commercial\/support\/tickets\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(adminScript, /admin\/commercial\/attendance-disputes\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(adminScript, /资源不存在或不在你的分配范围/);
  assert.match(adminScript, /当前角色无权访问/);
  assert.match(reviewScript, /function parseReviewRoute/);
  assert.match(reviewScript, /function restoreReviewRoute/);
  assert.match(reviewScript, /window\.addEventListener\("popstate"/);
  assert.match(reviewScript, /案件地址格式无效/);
  assert.match(reviewScript, /无权访问人员交接/);
  for (const script of [adminScript, reviewScript]) {
    assert.match(script, /token\|password\|secret\|totp\|authorization/i);
    assert.match(script, /window\.history\[replace \? "replaceState" : "pushState"\]/);
  }
});

test("companion appeal controls expose and enforce independent review in the admin workbench", () => {
  const companionAppealLoader = adminScript.slice(
    adminScript.indexOf("async function loadCompanionAppeals"),
    adminScript.indexOf("async function loadLifecycle")
  );

  assert.match(adminHtml, /id="companionAppealStatusFilter"/);
  assert.match(adminHtml, /id="companionAppealPagination" class="pagination"/);
  assert.match(adminScript, /companionAppeals:\s*1/);
  assert.match(companionAppealLoader, /state\.pages\.companionAppeals = page/);
  assert.match(companionAppealLoader, /appeals\?page=\$\{page\}&pageSize=50&appealStatus=/);
  assert.match(companionAppealLoader, /renderPagination\(pagination, result\.pagination/);
  assert.match(companionAppealLoader, /陪伴者申诉队列加载失败/);
  assert.match(adminScript, /#companionAppealStatusFilter"\)\.addEventListener\("change", \(\) => loadCompanionAppeals\(1\)\)/);
  assert.match(adminScript, /item\.independentReviewEligible/);
  assert.match(adminScript, /不可复核自己的处置/);
  assert.match(adminScript, /必须由另一名授权人员独立复核/);
});

test("ordinary consumer account appeals are a loaded, paginated, independently controlled queue", () => {
  assert.match(adminHtml, /id="accountAppealsPanel"/);
  assert.match(adminHtml, /id="accountAppealStatusFilter"/);
  assert.match(adminHtml, /id="accountAppealPagination" class="pagination"/);
  assert.match(adminScript, /loadAccountAppeals\(state\.pages\.accountAppeals\)/);
  assert.match(adminScript, /account-appeals\?page=\$\{page\}&pageSize=50&status=/);
  assert.match(adminScript, /account-appeals\/\$\{encodeURIComponent\(item\.id\)\}\/claim/);
  assert.match(adminScript, /account-appeals\/\$\{encodeURIComponent\(item\.id\)\}\/resolve/);
  assert.match(adminScript, /item\.independentReviewEligible/);
  assert.match(adminScript, /item\.assignedToUserId === state\.user\?\.id/);
  assert.match(adminScript, /name: "resolution"/);
  assert.match(adminScript, /minlength: 10/);
  assert.match(adminScript, /maxlength: 1000/);
  assert.match(adminScript, /#accountAppealStatusFilter"\)\.addEventListener\("change", \(\) => loadAccountAppeals\(1\)\)/);
});

test("customer adult eligibility is an independent, paginated and privacy-bounded review queue", () => {
  const loader = adminScript.slice(
    adminScript.indexOf("async function loadCustomerAdultEligibility"),
    adminScript.indexOf("function renderDataRights")
  );
  assert.match(adminHtml, /id="customerAdultEligibilityPanel"/);
  assert.match(adminHtml, /id="customerAdultEligibilityStatusFilter"/);
  assert.match(adminHtml, /不接收或回显身份证号、证件照片/);
  assert.match(adminScript, /customer\.adult-eligibility\.manage/);
  assert.match(loader, /\/admin\/customer-adult-eligibility\?status=/);
  assert.match(loader, /page=\$\{page\}&pageSize=50/);
  assert.match(loader, /renderPagination\(pagination, data\.pagination/);
  assert.match(adminScript, /\/admin\/customer-adult-eligibility\/\$\{encodeURIComponent\(item\.id\)\}\/\$\{adult \? "adult" : "ineligible"\}/);
  assert.match(adminScript, /提交者不能复核自己的记录/);
  assert.match(adminScript, /仅允许不透明业务引用/);
  assert.match(adminScript, /服务结束时间超出有效期时仍会被服务端拒绝/);
  assert.match(adminScript, /#customerAdultEligibilityStatusFilter"\)\.addEventListener\("change", \(\) => loadCustomerAdultEligibility\(1\)\)/);
});

test("admin and review JavaScript parse without executing", () => {
  for (const script of ["public/admin/assets/app.js", "public/review/assets/app.js"]) {
    const result = spawnSync(process.execPath, ["--check", script], { encoding: "utf8" });
    assert.equal(result.status, 0, `${script} syntax error:\n${result.stderr}`);
  }
});
