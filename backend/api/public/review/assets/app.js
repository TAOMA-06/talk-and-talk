(() => {
  "use strict";

  const DEFAULT_REVIEW_API_BASE = "/api/v1/review";
  const REVIEW_LOGIN_ENDPOINT = "/api/v1/review/auth/login";
  const apiBase = window.REVIEW_API_BASE_URL || DEFAULT_REVIEW_API_BASE;
  const storageKeys = {
    access: "talk_and_talk_review_access_token",
    refresh: "talk_and_talk_review_refresh_token",
    reviewer: "talk_and_talk_review_identity",
    accessExpiresAt: "talk_and_talk_review_access_expires_at"
  };
  const state = {
    accessToken: sessionStorage.getItem(storageKeys.access) || "",
    refreshToken: sessionStorage.getItem(storageKeys.refresh) || "",
    reviewer: parseStoredReviewer(),
    accessExpiresAt: Number(sessionStorage.getItem(storageKeys.accessExpiresAt) || 0),
    reviewers: [],
    reviewerQuery: { keyword: "", role: "", page: 1, pageSize: 20 },
    reviewerPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    reviewerLoading: false,
    reviewerError: "",
    staffDirectory: [],
    activeLeadCount: 0,
    staffFilters: { keyword: "", status: "", role: "", page: 1, pageSize: 25 },
    staffPagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
    staffError: "",
    overview: null,
    cases: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
    selectedCaseId: null,
    selectedCase: null,
    currentView: "workbench",
    filters: { page: 1, pageSize: 50 },
    conversationEvidence: null,
    labelExport: { snapshotAt: "", nextCursor: "", page: 0 }
  };

  const actionLabels = {
    confirmViolation: "确认违规",
    dismiss: "放行案件",
    escalate: "升级复核",
    approveMessage: "放行消息",
    rejectMessage: "驳回消息",
    restrict24h: "限言 24 小时",
    restrict7d: "限言 7 天",
    liftRestriction: "解除限言",
    upholdAppeal: "驳回申诉",
    overturnAppeal: "申诉成立"
  };
  const highImpactActions = new Set([
    "confirmViolation", "rejectMessage", "restrict24h", "restrict7d", "upholdAppeal", "overturnAppeal"
  ]);
  const noteRequiredActions = highImpactActions;
  const leadOnlyActions = new Set(["restrict24h", "restrict7d", "liftRestriction"]);
  const messageEvidenceRequiredActions = new Set([
    "confirmViolation", "rejectMessage", "restrict24h", "restrict7d", "upholdAppeal"
  ]);
  const reviewViews = new Set(["workbench", "labels", "staff"]);
  const routeFilterValues = {
    status: new Set(["", "pending", "autoReviewing", "humanReview", "resolved", "dismissed"]),
    riskLevel: new Set(["", "high", "medium", "low"]),
    priority: new Set(["", "critical", "high", "normal"]),
    source: new Set(["", "chat", "community", "report", "profile"])
  };

  const elements = {
    loginView: document.querySelector("#loginView"),
    portalView: document.querySelector("#portalView"),
    loginForm: document.querySelector("#loginForm"),
    loginButton: document.querySelector("#loginButton"),
    loginMessage: document.querySelector("#loginMessage"),
    reviewerName: document.querySelector("#reviewerName"),
    reviewerRole: document.querySelector("#reviewerRole"),
    reviewerInitials: document.querySelector("#reviewerInitials"),
    sessionRemaining: document.querySelector("#sessionRemaining"),
    logoutButton: document.querySelector("#logoutButton"),
    refreshButton: document.querySelector("#refreshButton"),
    lastUpdated: document.querySelector("#lastUpdated"),
    pageTitle: document.querySelector("#pageTitle"),
    workbenchView: document.querySelector("#workbenchView"),
    labelsView: document.querySelector("#labelsView"),
    staffView: document.querySelector("#staffView"),
    staffOffboardingList: document.querySelector("#staffOffboardingList"),
    staffOffboardingMessage: document.querySelector("#staffOffboardingMessage"),
    staffOffboardingFilterForm: document.querySelector("#staffOffboardingFilterForm"),
    staffOffboardingKeyword: document.querySelector("#staffOffboardingKeyword"),
    staffOffboardingStatus: document.querySelector("#staffOffboardingStatus"),
    staffOffboardingRole: document.querySelector("#staffOffboardingRole"),
    staffOffboardingPagination: document.querySelector("#staffOffboardingPagination"),
    staffOffboardingStatusMessage: document.querySelector("#staffOffboardingStatusMessage"),
    staffHandoffReviewerFilterForm: document.querySelector("#staffHandoffReviewerFilterForm"),
    staffHandoffReviewerKeyword: document.querySelector("#staffHandoffReviewerKeyword"),
    staffHandoffReviewerRole: document.querySelector("#staffHandoffReviewerRole"),
    staffHandoffReviewerMore: document.querySelector("#staffHandoffReviewerMore"),
    staffHandoffReviewerStatus: document.querySelector("#staffHandoffReviewerStatus"),
    metricPending: document.querySelector("#metricPending"),
    metricReview: document.querySelector("#metricReview"),
    metricBlocked: document.querySelector("#metricBlocked"),
    metricLabels: document.querySelector("#metricLabels"),
    metricPriority: document.querySelector("#metricPriority"),
    caseCount: document.querySelector("#caseCount"),
    caseList: document.querySelector("#caseList"),
    pagination: document.querySelector("#pagination"),
    caseDetail: document.querySelector("#caseDetail"),
    filterForm: document.querySelector("#filterForm"),
    filterStatus: document.querySelector("#filterStatus"),
    filterRisk: document.querySelector("#filterRisk"),
    filterPriority: document.querySelector("#filterPriority"),
    filterSource: document.querySelector("#filterSource"),
    filterKeyword: document.querySelector("#filterKeyword"),
    labelForm: document.querySelector("#labelForm"),
    labelText: document.querySelector("#labelText"),
    expectedDecision: document.querySelector("#expectedDecision"),
    actualDecision: document.querySelector("#actualDecision"),
    labelNote: document.querySelector("#labelNote"),
    labelMessage: document.querySelector("#labelMessage"),
    exportLabelsButton: document.querySelector("#exportLabelsButton"),
    exportPolicyNote: document.querySelector("#exportPolicyNote"),
    toast: document.querySelector("#toast")
  };

  function parseStoredReviewer() {
    try {
      const raw = sessionStorage.getItem(storageKeys.reviewer);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(date);
  }

  function shortId(value) {
    return value ? `${String(value).slice(0, 8)}…` : "—";
  }

  function parseJwtExpiry(token) {
    try {
      const payload = token.split(".")[1];
      if (!payload) return 0;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = JSON.parse(window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
      return Number(decoded.exp || 0) * 1000;
    } catch {
      return 0;
    }
  }

  function formatDuration(milliseconds) {
    const totalMinutes = Math.max(0, Math.ceil(Math.abs(milliseconds) / 60_000));
    if (totalMinutes < 60) return `${totalMinutes} 分钟`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 24) return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
    const days = Math.floor(hours / 24);
    return `${days} 天 ${hours % 24} 小时`;
  }

  function slaState(dueAt, closed = false) {
    if (closed) return { label: "已结案", className: "closed" };
    if (!dueAt) return { label: "未设置 SLA", className: "" };
    const due = new Date(dueAt).getTime();
    if (!Number.isFinite(due)) return { label: "SLA 异常", className: "overdue" };
    const delta = due - Date.now();
    if (delta <= 0) return { label: `已超时 ${formatDuration(delta)}`, className: "overdue" };
    if (delta <= 60 * 60_000) return { label: `剩余 ${formatDuration(delta)}`, className: "due-soon" };
    return { label: `剩余 ${formatDuration(delta)}`, className: "" };
  }

  function reviewerDisplayName(reviewerId) {
    if (!reviewerId) return "未认领";
    if (reviewerId === state.reviewer?.id) return "由我处理";
    const reviewer = [...state.reviewers, ...state.staffDirectory].find((item) => item.id === reviewerId);
    return reviewer?.displayName || reviewer?.username || `审核员 ${shortId(reviewerId)}`;
  }

  function updateTemporalLabels() {
    const remaining = state.accessExpiresAt - Date.now();
    if (elements.sessionRemaining) {
      elements.sessionRemaining.classList.toggle("warning", remaining > 0 && remaining <= 2 * 60_000);
      elements.sessionRemaining.classList.toggle("expired", remaining <= 0);
      elements.sessionRemaining.textContent = remaining > 0
        ? `会话：${formatDuration(remaining)}`
        : "会话：等待续期";
    }
    document.querySelectorAll("[data-due-at]").forEach((element) => {
      const result = slaState(element.dataset.dueAt, element.dataset.caseClosed === "true");
      element.textContent = result.label;
      element.classList.remove("due-soon", "overdue", "closed");
      if (result.className) element.classList.add(result.className);
    });
  }

  function roleName(role) {
    return role === "lead" ? "审核负责人" : "审核员";
  }

  function sourceName(source) {
    return { chat: "聊天", community: "社区", report: "举报", profile: "资料" }[source] || source || "未知来源";
  }

  function riskName(value) {
    return { high: "高风险", medium: "中风险", low: "低风险" }[value] || value || "—";
  }

  function statusName(value) {
    return {
      pending: "待处理", autoReviewing: "自动复核", humanReview: "人工复核", resolved: "已解决", dismissed: "已放行"
    }[value] || value || "未知";
  }

  function setFormMessage(element, message, isSuccess = false) {
    element.textContent = message || "";
    element.classList.toggle("success", Boolean(isSuccess && message));
  }

  let toastTimer;
  function showToast(message, isError = false) {
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", isError);
    elements.toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3200);
  }

  function persistSession(tokens, reviewer) {
    state.accessToken = tokens.accessToken;
    state.refreshToken = tokens.refreshToken;
    state.reviewer = reviewer;
    state.accessExpiresAt = Number(tokens.expiresIn) > 0
      ? Date.now() + Number(tokens.expiresIn) * 1000
      : parseJwtExpiry(tokens.accessToken);
    sessionStorage.setItem(storageKeys.access, state.accessToken);
    sessionStorage.setItem(storageKeys.refresh, state.refreshToken);
    sessionStorage.setItem(storageKeys.reviewer, JSON.stringify(reviewer));
    sessionStorage.setItem(storageKeys.accessExpiresAt, String(state.accessExpiresAt));
    updateTemporalLabels();
  }

  function clearSession() {
    state.accessToken = "";
    state.refreshToken = "";
    state.reviewer = null;
    state.accessExpiresAt = 0;
    state.reviewers = [];
    state.reviewerPagination = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
    state.reviewerError = "";
    state.staffDirectory = [];
    state.activeLeadCount = 0;
    state.staffPagination = { page: 1, pageSize: 25, total: 0, totalPages: 0 };
    state.staffError = "";
    state.selectedCaseId = null;
    state.selectedCase = null;
    sessionStorage.removeItem(storageKeys.access);
    sessionStorage.removeItem(storageKeys.refresh);
    sessionStorage.removeItem(storageKeys.reviewer);
    sessionStorage.removeItem(storageKeys.accessExpiresAt);
  }

  async function parseResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error?.message || `请求失败（${response.status}）`);
      error.status = response.status;
      error.code = body?.error?.code;
      throw error;
    }
    return body?.data;
  }

  async function request(path, options = {}, allowRefresh = true) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (state.accessToken && options.authenticated !== false) headers.Authorization = `Bearer ${state.accessToken}`;
    const endpoint = path.startsWith("http") ? path : `${apiBase}${path}`;
    try {
      return await parseResponse(await fetch(endpoint, { ...options, headers }));
    } catch (error) {
      if (error.status === 401 && allowRefresh && state.refreshToken && !path.includes("/auth/refresh")) {
        const refreshed = await refreshSession();
        if (refreshed) return request(path, options, false);
      }
      throw error;
    }
  }

  let refreshPromise = null;
  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const data = await request("/auth/refresh", {
          method: "POST",
          authenticated: false,
          body: JSON.stringify({ refreshToken: state.refreshToken })
        }, false);
        persistSession(data, data.reviewer);
        return true;
      } catch {
        clearSession();
        showLogin("审核会话已失效，请重新登录。");
        return false;
      }
    })();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  function showLogin(message = "") {
    elements.portalView.classList.add("hidden");
    elements.loginView.classList.remove("hidden");
    setFormMessage(elements.loginMessage, message);
    window.setTimeout(() => document.querySelector("#loginUsername")?.focus(), 0);
  }

  function showPortal() {
    elements.loginView.classList.add("hidden");
    elements.portalView.classList.remove("hidden");
    const reviewer = state.reviewer;
    elements.reviewerName.textContent = reviewer?.displayName || reviewer?.username || "审核员";
    elements.reviewerRole.textContent = roleName(reviewer?.role);
    elements.reviewerInitials.textContent = (reviewer?.displayName || reviewer?.username || "审").slice(0, 1);
    document.body.classList.toggle("reviewer-is-lead", reviewer?.role === "lead");
    elements.exportLabelsButton.disabled = reviewer?.role !== "lead";
    elements.exportPolicyNote.textContent = reviewer?.role === "lead"
      ? "导出会生成带时间戳的 JSON，并写入独立审核审计轨迹。"
      : "审核样本导出仅限审核负责人；普通审核员可以新增标注，但不能提取全量样本。";
    updateTemporalLabels();
  }

  function sanitizeLocation() {
    const url = new URL(window.location.href);
    let changed = Boolean(url.hash);
    [...url.searchParams.keys()].forEach((key) => {
      if (/token|password|secret|totp|authorization/i.test(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    });
    if (url.hash) url.hash = "";
    if (changed) window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function parseReviewRoute() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view") || "workbench";
    if (!reviewViews.has(view)) {
      return { invalid: true, reason: "这个审核工作区地址不存在。" };
    }
    const caseId = params.get("case") || "";
    if (caseId && (!/^[A-Za-z0-9._:-]+$/.test(caseId) || caseId.length > 128)) {
      return { invalid: true, reason: "案件地址格式无效。" };
    }
    const pageRaw = params.get("page") || "1";
    const page = Number(pageRaw);
    if (!/^\d+$/.test(pageRaw) || page < 1 || page > 100000) {
      return { invalid: true, reason: "队列页码无效。" };
    }
    const filters = {
      status: params.get("status") || "",
      riskLevel: params.get("risk") || "",
      priority: params.get("priority") || "",
      source: params.get("source") || ""
    };
    if (Object.entries(filters).some(([key, value]) => !routeFilterValues[key].has(value))) {
      return { invalid: true, reason: "筛选地址无效。" };
    }
    return { invalid: false, view, caseId, page, filters };
  }

  function applyRouteFilters(route) {
    elements.filterStatus.value = route.filters.status;
    elements.filterRisk.value = route.filters.riskLevel;
    elements.filterPriority.value = route.filters.priority;
    elements.filterSource.value = route.filters.source;
    elements.filterKeyword.value = "";
    state.filters = { ...route.filters, keyword: "", page: route.page, pageSize: 50 };
  }

  function writeReviewRoute(replace = false) {
    const params = new URLSearchParams();
    params.set("view", state.currentView);
    if (state.currentView === "workbench" && state.selectedCaseId) {
      params.set("case", state.selectedCaseId);
    }
    const safeFilters = {
      status: state.filters.status,
      risk: state.filters.riskLevel,
      priority: state.filters.priority,
      source: state.filters.source
    };
    Object.entries(safeFilters).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
    if (Number(state.filters.page || 1) > 1) params.set("page", String(state.filters.page));
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history[replace ? "replaceState" : "pushState"](null, "", next);
  }

  function renderRouteState(status, title, message) {
    state.currentView = "workbench";
    elements.workbenchView?.classList.remove("hidden");
    elements.labelsView?.classList.add("hidden");
    elements.staffView?.classList.add("hidden");
    elements.pageTitle.textContent = `${status} · ${title}`;
    document.querySelectorAll("[data-view-target]").forEach((button) => button.classList.remove("active"));
    elements.caseList.innerHTML = `<div class="list-empty">${escapeHtml(title)}</div>`;
    elements.pagination.innerHTML = "";
    elements.caseDetail.className = "case-detail empty-state";
    elements.caseDetail.innerHTML = `<div class="empty-mark" aria-hidden="true">${status === 404 ? "404" : "!"}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>`;
  }

  function setLoadingList() {
    elements.caseList.innerHTML = '<div class="loading">正在加载受控审核队列…</div>';
  }

  function renderOverview() {
    const overview = state.overview || {};
    elements.metricPending.textContent = String(overview.pendingCases ?? 0);
    elements.metricReview.textContent = String(overview.reviewed ?? 0);
    elements.metricBlocked.textContent = String(overview.blocked ?? 0);
    elements.metricLabels.textContent = String(overview.labels ?? 0);
    const high = overview?.byRisk?.high ?? 0;
    elements.metricPriority.textContent = high ? `含 ${high} 条高风险案件` : "当前无高风险案件";
  }

  function tag(value, display) {
    return `<span class="tag ${escapeHtml(value)}">${escapeHtml(display)}</span>`;
  }

  function renderCaseList() {
    const cases = state.cases || [];
    elements.caseCount.textContent = String(state.pagination.total ?? cases.length);
    if (!cases.length) {
      elements.caseList.innerHTML = '<div class="list-empty">没有与当前筛选条件匹配的工单。</div>';
      renderPagination();
      return;
    }
    elements.caseList.innerHTML = cases.map((item) => {
      const active = item.id === state.selectedCaseId ? "active" : "";
      const closed = ["resolved", "dismissed"].includes(item.status);
      const sla = slaState(item.dueAt, closed);
      const assignmentClass = item.assignedToUserId === state.reviewer?.id ? "mine" : "";
      return `
        <button class="case-card ${active}" type="button" data-case-id="${escapeHtml(item.id)}">
          <div class="case-card-top">${tag(item.priority || "normal", item.priority === "critical" ? "紧急" : item.priority === "high" ? "高优先级" : "普通")} ${tag(item.riskLevel, riskName(item.riskLevel))}</div>
          <h3>${escapeHtml(item.title || "未命名案件")}</h3>
          <p>${escapeHtml(item.content || "无文本内容")}</p>
          <div class="case-card-meta"><span>${escapeHtml(sourceName(item.source))} · ${escapeHtml(statusName(item.status))}</span><time>${escapeHtml(formatTime(item.createdAt))}</time></div>
          <div class="case-card-ops">
            <span class="assignment-label ${assignmentClass}">${escapeHtml(reviewerDisplayName(item.assignedToUserId))}</span>
            <span class="sla-badge ${sla.className}" data-due-at="${escapeHtml(item.dueAt || "")}" data-case-closed="${closed}">${escapeHtml(sla.label)}</span>
          </div>
        </button>`;
    }).join("");
    elements.caseList.querySelectorAll("[data-case-id]").forEach((button) => {
      button.addEventListener("click", () => selectCase(button.dataset.caseId));
    });
    renderPagination();
    updateTemporalLabels();
  }

  function renderPagination() {
    const pagination = state.pagination || {};
    const page = Number(pagination.page || 1);
    const totalPages = Math.max(1, Number(pagination.totalPages || 1));
    elements.pagination.innerHTML = `
      <span>第 ${page} / ${totalPages} 页</span>
      <span class="pagination-controls">
        <button type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
        <button type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
      </span>`;
    elements.pagination.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = Number(button.dataset.page);
        if (next >= 1 && next <= totalPages) {
          void loadCases(next).then(() => writeReviewRoute());
        }
      });
    });
  }

  function jsonPreview(value) {
    try {
      const output = JSON.stringify(value ?? {}, null, 2);
      return output.length > 1600 ? `${output.slice(0, 1600)}\n…` : output;
    } catch {
      return "证据数据无法预览";
    }
  }

  function safeMediaUrl(value) {
    if (!value) return null;
    try {
      const parsed = new URL(value, window.location.origin);
      const isSameOrigin = parsed.origin === window.location.origin;
      if (parsed.protocol === "https:" || (parsed.protocol === "http:" && isSameOrigin)) {
        return { href: parsed.href, isSameOrigin };
      }
    } catch {
      return null;
    }
    return null;
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "大小未知";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function renderAttachment(asset) {
    const media = safeMediaUrl(asset.url);
    const kind = asset.kind === "image" ? "图片" : asset.kind === "audio" ? "音频" : "附件";
    const duration = Number(asset.durationMs) > 0 ? ` · ${Math.ceil(Number(asset.durationMs) / 1000)} 秒` : "";
    const link = media
      ? `<a class="attachment-link" href="${escapeHtml(media.href)}" target="_blank" rel="noopener noreferrer">受控查看 ↗</a>`
      : '<span class="attachment-meta">当前不可读取</span>';
    const preview = media?.isSameOrigin && asset.kind === "image"
      ? `<img class="attachment-preview" src="${escapeHtml(media.href)}" alt="审核证据图片" loading="lazy" referrerpolicy="no-referrer" />`
      : media?.isSameOrigin && asset.kind === "audio"
        ? `<audio class="attachment-audio" controls preload="metadata" src="${escapeHtml(media.href)}"></audio>`
        : "";
    const extracted = asset.extractedText
      ? `<div class="attachment-analysis"><strong>提取文本</strong><br />${escapeHtml(asset.extractedText)}</div>`
      : "";
    const analysis = asset.analysis
      ? `<div class="attachment-analysis"><strong>机器分析</strong><br />${escapeHtml(jsonPreview(asset.analysis))}</div>`
      : "";
    return `
      <div class="attachment-card">
        <div class="attachment-head">
          <div><strong>${escapeHtml(kind)} · ${escapeHtml(asset.status || "unknown")}</strong><div class="attachment-meta">${escapeHtml(asset.mimeType || "未知类型")} · ${escapeHtml(formatBytes(asset.sizeBytes))}${escapeHtml(duration)}</div></div>
          ${link}
        </div>
        ${preview}${extracted}${analysis}
      </div>`;
  }

  function renderAssignmentControls(item, open) {
    const assignee = reviewerDisplayName(item.assignedToUserId);
    const mine = item.assignedToUserId === state.reviewer?.id;
    const pendingAppeal = (item.appeals || []).find((appeal) => appeal.status === "pending");
    const blockedByIndependence = pendingAppeal?.originalReviewerId === state.reviewer?.id;
    const canClaim = open && !item.assignedToUserId && !blockedByIndependence;
    const reviewerOptions = [
      '<option value="">解除分配</option>',
      ...(item.assignedToUserId && !state.reviewers.some((reviewer) => reviewer.id === item.assignedToUserId)
        ? [`<option value="${escapeHtml(item.assignedToUserId)}" selected>${escapeHtml(assignee)} · 当前负责人</option>`]
        : []),
      ...state.reviewers.map((reviewer) => {
        const isOriginalReviewer = pendingAppeal?.originalReviewerId === reviewer.id;
        return `<option value="${escapeHtml(reviewer.id)}" ${reviewer.id === item.assignedToUserId ? "selected" : ""} ${isOriginalReviewer ? "disabled" : ""}>${escapeHtml(reviewer.displayName || reviewer.username)} · ${escapeHtml(roleName(reviewer.role))}${isOriginalReviewer ? " · 原处置人不可复核" : ""}</option>`;
      })
    ].join("");
    const hasMoreReviewers = state.reviewerPagination.page < state.reviewerPagination.totalPages;
    const reviewerStatus = state.reviewerError
      ? `<span class="reviewer-picker-status error">${escapeHtml(state.reviewerError)}；已保留当前 ${state.reviewers.length} 项</span>`
      : `<span class="reviewer-picker-status">已加载 ${state.reviewers.length} / ${state.reviewerPagination.total} 名 active 审核人员</span>`;
    const leadControls = state.reviewer?.role === "lead" && open
      ? `<div class="reviewer-picker"><input id="assignmentReviewerKeyword" maxlength="120" value="${escapeHtml(state.reviewerQuery.keyword)}" placeholder="搜索姓名或审核账号" aria-label="搜索可转派审核员" /><select id="assignmentReviewerRole" aria-label="筛选可转派审核员角色"><option value="" ${state.reviewerQuery.role ? "" : "selected"}>全部角色</option><option value="lead" ${state.reviewerQuery.role === "lead" ? "selected" : ""}>负责人</option><option value="reviewer" ${state.reviewerQuery.role === "reviewer" ? "selected" : ""}>审核员</option></select><button class="button quiet" id="searchAssignmentReviewersButton" type="button" ${state.reviewerLoading ? "disabled" : ""}>搜索</button><button class="button quiet" id="loadMoreAssignmentReviewersButton" type="button" ${state.reviewerLoading || !hasMoreReviewers ? "disabled" : ""}>${state.reviewerLoading ? "加载中…" : hasMoreReviewers ? "加载更多" : "已加载全部"}</button><select class="assignment-select" id="assignmentReviewer" aria-label="选择审核员">${reviewerOptions}</select><button class="button quiet" id="assignCaseButton" type="button">确认转派</button>${reviewerStatus}</div>`
      : "";
    const claim = canClaim
      ? '<button class="button primary" id="claimCaseButton" type="button">认领案件</button>'
      : "";
    const message = !open
      ? "案件已结案，分配关系仅供审计查阅。"
      : blockedByIndependence
        ? "你是原处置审核员。为保证独立复核，本申诉必须由其他审核员认领和裁决。"
      : mine
        ? "该案件已锁定到你的工作队列。"
        : item.assignedToUserId
          ? "仅当前负责人可提交判断；审核负责人可转派。"
          : "提交处置前请先认领，避免多人同时判断。";
    return `
      <div class="ownership-bar">
        <div class="ownership-copy"><span>案件负责人</span><strong>${escapeHtml(assignee)}</strong><small>${escapeHtml(message)}</small></div>
        <div class="ownership-actions">${claim}${leadControls}</div>
      </div>`;
  }

  function bindCaseAssignmentControls() {
    elements.caseDetail.querySelector("#claimCaseButton")?.addEventListener("click", claimSelectedCase);
    elements.caseDetail.querySelector("#assignCaseButton")?.addEventListener("click", assignSelectedCase);
    elements.caseDetail.querySelector("#searchAssignmentReviewersButton")?.addEventListener("click", async () => {
      state.reviewerQuery.keyword = elements.caseDetail.querySelector("#assignmentReviewerKeyword")?.value?.trim() || "";
      state.reviewerQuery.role = elements.caseDetail.querySelector("#assignmentReviewerRole")?.value || "";
      await loadReviewers(1, false);
    });
    elements.caseDetail.querySelector("#loadMoreAssignmentReviewersButton")?.addEventListener("click", async () => {
      if (state.reviewerPagination.page >= state.reviewerPagination.totalPages) return;
      await loadReviewers(state.reviewerPagination.page + 1, true);
    });
  }

  function refreshReviewerDependentControls() {
    const section = elements.caseDetail.querySelector("#caseAssignmentSection");
    if (section && state.selectedCase) {
      const open = ["pending", "autoReviewing", "humanReview"].includes(state.selectedCase.status);
      section.innerHTML = renderAssignmentControls(state.selectedCase, open);
      bindCaseAssignmentControls();
    }
    renderStaffOffboarding();
  }

  function renderCaseDetail(result) {
    const item = result.case;
    state.selectedCase = item;
    state.conversationEvidence = {
      caseId: item.id,
      anchorMessageId: item.messageId || null,
      anchorVerified: !item.messageId,
      messages: [],
      beforeCursor: null,
      afterCursor: null,
      hasMoreBefore: false,
      hasMoreAfter: false,
      loadingDirection: "initial",
      error: "",
      retryDirection: "initial"
    };
    const open = ["pending", "autoReviewing", "humanReview"].includes(item.status);
    const pendingAppeal = (item.appeals || []).find((appeal) => appeal.status === "pending");
    const blockedByIndependence = pendingAppeal?.originalReviewerId === state.reviewer?.id;
    const canAct = open && !blockedByIndependence && (!item.assignedToUserId || item.assignedToUserId === state.reviewer?.id);
    const sla = slaState(item.dueAt, !open);
    const evidence = (item.evidences || []).map((entry) => `
      <article class="evidence-item"><strong>${escapeHtml(entry.type || "evidence")}</strong><pre>${escapeHtml(jsonPreview(entry.payload))}</pre></article>`).join("") || '<p class="muted">没有附加证据。</p>';
    const appeals = (item.appeals || []).map((appeal) => {
      const appealSla = slaState(appeal.reviewDueAt, appeal.status !== "pending");
      return `
      <article class="log-item"><span class="log-dot"></span><div><strong>申诉 · ${escapeHtml(appeal.status || "pending")}</strong><p>${escapeHtml(appeal.reason || "无申诉说明")}</p><small>提交：${escapeHtml(formatTime(appeal.createdAt))} · 复核截止：${escapeHtml(appeal.reviewDueAt ? formatTime(appeal.reviewDueAt) : "未设置")} · ${escapeHtml(appealSla.label)} · 策略 ${escapeHtml(appeal.policyVersion || "—")}</small><p class="muted">${appeal.independentReviewRequired ? "必须由非原处置审核员完成独立复核。" : "原处置为自动判断，由授权审核员完成人工复核。"}</p></div></article>`;
    }).join("") || "";
    const logs = (item.actionLog || []).map((log) => `
      <article class="log-item"><span class="log-dot"></span><div><strong>${escapeHtml(actionLabels[log.action] || log.action)}</strong><p>${escapeHtml(log.note || "未填写处置说明")}</p><small>审核员：${escapeHtml(shortId(log.reviewerId || log.actorId))} · ${escapeHtml(formatTime(log.createdAt))}</small></div></article>`).join("") || '<p class="muted">尚无人工处置记录。</p>';
    const actions = open
      ? canAct
        ? renderActionButtons(item)
        : blockedByIndependence
          ? '<p class="muted">你是原处置审核员，不能认领、接收转派或裁决这项申诉。</p>'
          : '<p class="muted">此案件已分配给其他审核员；如需接手，请由审核负责人完成转派。</p>'
      : '<p class="muted">该案件已经结案。所有历史判断与证据均保留在本部门审计轨迹中。</p>';
    elements.caseDetail.className = "case-detail";
    elements.caseDetail.innerHTML = `
      <header class="case-header">
        <div><p class="eyebrow">${escapeHtml(sourceName(item.source))} · ${escapeHtml(statusName(item.status))}</p><h2>${escapeHtml(item.title || "未命名案件")}</h2><p class="case-id">案件 ${escapeHtml(item.id)}</p></div>
        <div>${tag(item.priority || "normal", item.priority === "critical" ? "紧急" : item.priority === "high" ? "高优先级" : "普通")} ${tag(item.riskLevel || "low", riskName(item.riskLevel))} <span class="sla-badge ${sla.className}" data-due-at="${escapeHtml(item.dueAt || "")}" data-case-closed="${!open}">${escapeHtml(sla.label)}</span></div>
      </header>
      <section id="caseAssignmentSection" class="case-section">${renderAssignmentControls(item, open)}</section>
      <section class="case-section"><h3>待审内容</h3><p class="case-content">${escapeHtml(item.content || "无可展示文本")}</p><div class="source-chips"><span class="tag">模型：${escapeHtml(item.provider || "规则引擎")}</span><span class="tag">策略：${escapeHtml(item.policyVersion || "—")}</span><span class="tag">风险分：${escapeHtml(item.aiScore ?? "—")}</span></div></section>
      <section class="case-section"><h3>判断摘要</h3><div class="detail-metadata"><div><span>初始结论</span><strong>${escapeHtml(item.decision || "—")}</strong></div><div><span>模型理由</span><strong title="${escapeHtml(item.aiReason || "—")}">${escapeHtml(item.aiReason || "—")}</strong></div><div><span>SLA 截止</span><strong>${escapeHtml(item.dueAt ? formatTime(item.dueAt) : "未设置")}</strong></div></div></section>
      <section class="case-section"><h3>案件证据</h3><div class="evidence-list">${evidence}</div></section>
      <section class="case-section"><h3>会话上下文</h3><div id="conversationEvidence" class="message-list"><p class="muted">正在请求最小必要会话上下文…</p></div></section>
      ${appeals ? `<section class="case-section"><h3>用户申诉</h3><div class="log-list">${appeals}</div></section>` : ""}
      <section class="case-section"><h3>处置轨迹</h3><div class="log-list">${logs}</div></section>
      <section class="case-section"><div class="action-shell"><h3>提交审核判断</h3><p>高风险处置必须写明理由；限言仅限审核负责人执行。提交后业务侧仅接收该条受控决策。</p><textarea id="actionNote" class="action-note" maxlength="1000" placeholder="填写审核依据、上下文或申诉裁决理由" ${canAct ? "" : "disabled"}></textarea><div class="action-grid">${actions}</div></div></section>`;
    elements.caseDetail.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => submitAction(button.dataset.action));
    });
    bindCaseAssignmentControls();
    updateTemporalLabels();
    loadConversation(item.id);
  }

  function renderActionButtons(item) {
    const pendingAppeal = (item.appeals || []).some((appeal) => appeal.status === "pending");
    const actions = [
      ["approveMessage", "放行消息", "primary"],
      ["dismiss", "放行案件", "quiet"],
      ["escalate", "升级复核", "quiet"],
      ["rejectMessage", "驳回消息", "danger"],
      ["confirmViolation", "确认违规", "warn"],
      ["restrict24h", "限言 24h", "warn lead-only"],
      ["restrict7d", "限言 7d", "danger lead-only"],
      ["liftRestriction", "解除限言", "quiet lead-only"]
    ];
    if (pendingAppeal) {
      actions.push(["upholdAppeal", "驳回申诉", "warn"], ["overturnAppeal", "申诉成立", "primary"]);
    }
    const anchorBlocked = Boolean(item.messageId && !state.conversationEvidence?.anchorVerified);
    return actions.map(([action, label, classes]) => {
      const requiresEvidence = messageEvidenceRequiredActions.has(action);
      const disabled = anchorBlocked && requiresEvidence;
      return `<button class="button ${classes}" type="button" data-action="${action}" ${requiresEvidence ? 'data-message-evidence-required="true"' : ""} ${disabled ? 'disabled aria-disabled="true" title="需先成功读取并核对举报消息"' : ""}>${label}</button>`;
    }).join("");
  }

  function mergeEvidenceMessages(...pages) {
    const byId = new Map();
    pages.flat().forEach((message) => {
      if (message?.id) byId.set(message.id, message);
    });
    return [...byId.values()].sort((left, right) => {
      const time = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
      return time || String(left.id).localeCompare(String(right.id));
    });
  }

  function updateMessageEvidenceActions() {
    const verified = Boolean(state.conversationEvidence?.anchorVerified);
    document.querySelectorAll('[data-message-evidence-required="true"]').forEach((button) => {
      button.disabled = !verified;
      button.setAttribute("aria-disabled", String(!verified));
      button.title = verified ? "" : "需先成功读取并核对举报消息";
    });
  }

  function renderConversationEvidence() {
    const container = document.querySelector("#conversationEvidence");
    const evidence = state.conversationEvidence;
    if (!container || !evidence) return;
    const error = evidence.error
      ? `<div class="evidence-load-error" role="alert"><strong>会话证据读取失败</strong><span>${escapeHtml(evidence.error)}</span><button class="button quiet" type="button" data-evidence-retry="${escapeHtml(evidence.retryDirection)}">重试本次读取</button></div>`
      : "";
    if (evidence.loadingDirection === "initial" && !evidence.messages.length) {
      container.innerHTML = `${error}<p class="muted">正在定位举报消息并读取前后文…</p>`;
      updateMessageEvidenceActions();
      return;
    }
    const messages = evidence.messages.map((message) => {
      const isAnchor = evidence.anchorMessageId && message.id === evidence.anchorMessageId;
      return `
        <article id="review-message-${escapeHtml(message.id)}" class="message-item ${isAnchor ? "reported-message" : ""}" ${isAnchor ? 'data-reported-message="true"' : ""}>
          <strong>${escapeHtml(message.senderName || shortId(message.senderId))} <span class="tag ${escapeHtml(message.moderationStatus || "pending")}">${escapeHtml(message.moderationStatus || "未知状态")}</span>${isAnchor ? '<span class="reported-message-badge">举报锚点</span>' : ""}</strong>
          <p>${escapeHtml(message.content || "（非文本或空消息）")}</p>
          ${(message.attachments || []).length ? `<div class="attachment-list">${message.attachments.map(renderAttachment).join("")}</div>` : ""}
          <small>${escapeHtml(formatTime(message.timestamp))} · 消息 ${escapeHtml(shortId(message.id))}</small>
        </article>`;
    }).join("");
    const before = evidence.hasMoreBefore
      ? `<button class="button quiet evidence-page-button" type="button" data-evidence-page="before" ${evidence.loadingDirection ? "disabled" : ""}>${evidence.loadingDirection === "before" ? "正在加载…" : "加载更早上下文"}</button>`
      : '<span class="muted">已到会话开头</span>';
    const after = evidence.hasMoreAfter
      ? `<button class="button quiet evidence-page-button" type="button" data-evidence-page="after" ${evidence.loadingDirection ? "disabled" : ""}>${evidence.loadingDirection === "after" ? "正在加载…" : "加载更新上下文"}</button>`
      : '<span class="muted">已到会话结尾</span>';
    container.innerHTML = `${error}<div class="evidence-pagination">${before}<span>已读取 ${evidence.messages.length} 条必要上下文</span>${after}</div>${messages || '<p class="muted">此案件没有可展示的会话上下文。</p>'}`;
    container.querySelectorAll("[data-evidence-page]").forEach((button) => {
      button.addEventListener("click", () => loadConversation(evidence.caseId, button.dataset.evidencePage));
    });
    container.querySelector("[data-evidence-retry]")?.addEventListener("click", (event) => {
      loadConversation(evidence.caseId, event.currentTarget.dataset.evidenceRetry || "initial");
    });
    updateMessageEvidenceActions();
  }

  async function loadConversation(caseId, direction = "initial") {
    const evidence = state.conversationEvidence;
    if (!evidence || evidence.caseId !== caseId || evidence.loadingDirection && evidence.loadingDirection !== "initial") return;
    const cursor = direction === "before" ? evidence.beforeCursor : direction === "after" ? evidence.afterCursor : null;
    if (direction !== "initial" && !cursor) return;
    evidence.loadingDirection = direction;
    evidence.error = "";
    evidence.retryDirection = direction;
    renderConversationEvidence();
    try {
      const query = new URLSearchParams({ pageSize: "50" });
      if (direction === "before") query.set("before", cursor);
      if (direction === "after") query.set("after", cursor);
      const data = await request(`/cases/${encodeURIComponent(caseId)}/conversation?${query.toString()}`);
      if (state.selectedCaseId !== caseId || state.conversationEvidence !== evidence) return;
      if (evidence.anchorMessageId) {
        if (!data.anchorMessage || data.anchorMessage.id !== evidence.anchorMessageId) {
          throw new Error(`举报消息证据 ${evidence.anchorMessageId} 未能核对`);
        }
        evidence.anchorVerified = true;
      }
      evidence.messages = mergeEvidenceMessages(
        evidence.messages,
        data.messages || [],
        data.anchorMessage ? [data.anchorMessage] : []
      );
      if (direction === "initial" || direction === "before") {
        evidence.beforeCursor = data.pagination?.beforeCursor || null;
        evidence.hasMoreBefore = Boolean(data.pagination?.hasMoreBefore && evidence.beforeCursor);
      }
      if (direction === "initial" || direction === "after") {
        evidence.afterCursor = data.pagination?.afterCursor || null;
        evidence.hasMoreAfter = Boolean(data.pagination?.hasMoreAfter && evidence.afterCursor);
      }
      evidence.loadingDirection = "";
      renderConversationEvidence();
      if (direction === "initial" && evidence.anchorMessageId) {
        document.querySelector('[data-reported-message="true"]')?.scrollIntoView?.({ block: "center" });
      }
    } catch (error) {
      if (state.selectedCaseId !== caseId || state.conversationEvidence !== evidence) return;
      evidence.loadingDirection = "";
      evidence.error = error.message || "无法加载会话证据";
      if (direction === "initial" && evidence.anchorMessageId) evidence.anchorVerified = false;
      renderConversationEvidence();
    }
  }

  async function claimSelectedCase() {
    if (!state.selectedCaseId || state.selectedCase?.assignedToUserId) return;
    try {
      await request(`/cases/${encodeURIComponent(state.selectedCaseId)}/claim`, { method: "POST" });
      showToast("案件已认领，处置权限已锁定到你的审核身份。");
      await loadDashboard(false);
      await selectCase(state.selectedCaseId, false, false);
    } catch (error) {
      showToast(error.message || "案件认领失败", true);
      await loadDashboard(false);
      if (state.selectedCaseId) await selectCase(state.selectedCaseId, false, false);
    }
  }

  async function assignSelectedCase() {
    if (state.reviewer?.role !== "lead" || !state.selectedCaseId) {
      showToast("仅审核负责人可以转派案件。", true);
      return;
    }
    const select = document.querySelector("#assignmentReviewer");
    const reviewerId = select?.value || undefined;
    const current = state.selectedCase?.assignedToUserId || undefined;
    if (reviewerId === current) {
      showToast("案件负责人没有变化。");
      return;
    }
    const target = reviewerId ? reviewerDisplayName(reviewerId) : "未分配队列";
    if (!window.confirm(`确认将当前案件转派至“${target}”吗？该变更会写入独立审核审计轨迹。`)) return;
    try {
      await request(`/cases/${encodeURIComponent(state.selectedCaseId)}/assignment`, {
        method: "POST",
        body: JSON.stringify({ reviewerId })
      });
      showToast(`案件已转派至：${target}`);
      await loadDashboard(false);
      await selectCase(state.selectedCaseId, false, false);
    } catch (error) {
      showToast(error.message || "案件转派失败", true);
    }
  }

  async function submitAction(action) {
    const note = document.querySelector("#actionNote")?.value?.trim() || "";
    if (
      state.selectedCase?.messageId
      && messageEvidenceRequiredActions.has(action)
      && !state.conversationEvidence?.anchorVerified
    ) {
      showToast("举报消息证据尚未成功读取；不利处置已关闭，请先重试证据读取。", true);
      document.querySelector("#conversationEvidence")?.scrollIntoView?.({ block: "center" });
      return;
    }
    if (noteRequiredActions.has(action) && !note) {
      showToast("此项高风险处置必须填写审核依据。", true);
      document.querySelector("#actionNote")?.focus();
      return;
    }
    if (leadOnlyActions.has(action) && state.reviewer?.role !== "lead") {
      showToast("此操作仅限审核负责人。", true);
      return;
    }
    const label = actionLabels[action] || action;
    if (highImpactActions.has(action) && !window.confirm(`确认提交“${label}”吗？该决定会通过受控通道影响业务状态。`)) return;
    try {
      const data = await request(`/cases/${encodeURIComponent(state.selectedCaseId)}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, note: note || undefined })
      });
      showToast(`已提交：${label}`);
      state.selectedCase = data.case;
      await loadDashboard(false);
      if (state.selectedCaseId) await selectCase(state.selectedCaseId, false, false);
    } catch (error) {
      showToast(error.message || "处置未能提交", true);
    }
  }

  async function selectCase(id, renderLoading = true, updateRoute = true) {
    state.selectedCaseId = id;
    if (updateRoute) writeReviewRoute();
    renderCaseList();
    if (renderLoading) {
      elements.caseDetail.className = "case-detail empty-state";
      elements.caseDetail.innerHTML = '<div class="empty-mark" aria-hidden="true">⌁</div><h2>正在读取案件</h2><p>仅加载完成审核判断所必需的证据与上下文。</p>';
    }
    try {
      const detail = await request(`/cases/${encodeURIComponent(id)}`);
      if (state.selectedCaseId === id) renderCaseDetail(detail);
    } catch (error) {
      if (state.selectedCaseId === id) {
        elements.caseDetail.innerHTML = `<div class="empty-mark" aria-hidden="true">!</div><h2>案件不可读取</h2><p>${escapeHtml(error.message)}</p>`;
      }
    }
  }

  function readFilters(page) {
    return {
      status: elements.filterStatus.value,
      riskLevel: elements.filterRisk.value,
      priority: elements.filterPriority.value,
      source: elements.filterSource.value,
      keyword: elements.filterKeyword.value.trim(),
      page,
      pageSize: 50
    };
  }

  async function loadCases(page = 1) {
    state.filters = readFilters(page);
    const query = new URLSearchParams();
    Object.entries(state.filters).forEach(([key, value]) => {
      if (value !== "" && value !== undefined && value !== null) query.set(key, String(value));
    });
    setLoadingList();
    const data = await request(`/cases?${query.toString()}`);
    state.cases = data.cases || [];
    state.pagination = data.pagination || state.pagination;
    if (state.selectedCaseId && !state.cases.some((item) => item.id === state.selectedCaseId)) {
      elements.caseDetail.className = "case-detail empty-state";
      elements.caseDetail.innerHTML = '<div class="empty-mark" aria-hidden="true">⌁</div><h2>正在保留深链案件</h2><p>该案件不在当前队列页；详情仍会通过案件主键独立读取。</p>';
    }
    renderCaseList();
  }

  async function loadReviewers(page = 1, append = false) {
    if (state.reviewer?.role !== "lead") {
      state.reviewers = [];
      state.reviewerPagination = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
      return;
    }
    if (state.reviewerLoading) return;
    state.reviewerLoading = true;
    state.reviewerError = "";
    refreshReviewerDependentControls();
    const query = new URLSearchParams({
      status: "active",
      page: String(page),
      pageSize: String(state.reviewerQuery.pageSize)
    });
    if (state.reviewerQuery.keyword) query.set("keyword", state.reviewerQuery.keyword);
    if (state.reviewerQuery.role) query.set("role", state.reviewerQuery.role);
    try {
      const data = await request(`/staff?${query.toString()}`);
      const nextItems = data.items || [];
      state.reviewers = append
        ? [...new Map([...state.reviewers, ...nextItems].map((item) => [item.id, item])).values()]
        : nextItems;
      state.reviewerPagination = data.pagination || {
        page,
        pageSize: state.reviewerQuery.pageSize,
        total: state.reviewers.length,
        totalPages: page
      };
      state.reviewerQuery.page = state.reviewerPagination.page;
    } catch (error) {
      state.reviewerError = error.message || "active 审核人员读取失败";
    } finally {
      state.reviewerLoading = false;
      refreshReviewerDependentControls();
    }
  }

  function renderStaffOffboarding() {
    if (!elements.staffOffboardingList) return;
    if (state.reviewer?.role !== "lead") {
      elements.staffOffboardingList.innerHTML = '<div class="list-empty">人员离职仅限审核负责人。</div>';
      return;
    }
    if (elements.staffOffboardingKeyword) elements.staffOffboardingKeyword.value = state.staffFilters.keyword;
    if (elements.staffOffboardingStatus) elements.staffOffboardingStatus.value = state.staffFilters.status;
    if (elements.staffOffboardingRole) elements.staffOffboardingRole.value = state.staffFilters.role;
    if (elements.staffHandoffReviewerKeyword) elements.staffHandoffReviewerKeyword.value = state.reviewerQuery.keyword;
    if (elements.staffHandoffReviewerRole) elements.staffHandoffReviewerRole.value = state.reviewerQuery.role;
    const hasMoreReviewers = state.reviewerPagination.page < state.reviewerPagination.totalPages;
    if (elements.staffHandoffReviewerMore) {
      elements.staffHandoffReviewerMore.disabled = state.reviewerLoading || !hasMoreReviewers;
      elements.staffHandoffReviewerMore.textContent = state.reviewerLoading
        ? "加载中…"
        : hasMoreReviewers
          ? "加载更多交接人"
          : "交接人已加载完";
    }
    if (elements.staffHandoffReviewerStatus) {
      elements.staffHandoffReviewerStatus.textContent = state.reviewerError
        ? `${state.reviewerError}；已保留当前 ${state.reviewers.length} 项。`
        : `已加载 ${state.reviewers.length} / ${state.reviewerPagination.total} 名 active 交接候选；可继续搜索或加载后页。`;
      elements.staffHandoffReviewerStatus.classList.toggle("error", Boolean(state.reviewerError));
    }
    if (elements.staffOffboardingPagination) {
      const pagination = state.staffPagination;
      elements.staffOffboardingPagination.innerHTML = `<button class="button quiet" type="button" data-staff-page="${Math.max(1, pagination.page - 1)}" ${pagination.page <= 1 ? "disabled" : ""}>上一页</button><span>第 ${pagination.page} / ${Math.max(1, pagination.totalPages)} 页 · 共 ${pagination.total} 人</span><button class="button quiet" type="button" data-staff-page="${pagination.page + 1}" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>下一页</button>`;
    }
    if (elements.staffOffboardingStatusMessage) {
      elements.staffOffboardingStatusMessage.textContent = state.staffError
        ? `${state.staffError}；已保留上次成功读取的目录。`
        : `当前页 ${state.staffDirectory.length} 人；active lead 全局总数 ${state.activeLeadCount}。`;
      elements.staffOffboardingStatusMessage.classList.toggle("error", Boolean(state.staffError));
    }
    if (!state.staffDirectory.length) {
      elements.staffOffboardingList.innerHTML = state.staffError
        ? '<div class="list-empty">审核人员目录暂时不可读取，请重试；不会以空结果覆盖上次成功数据。</div>'
        : '<div class="list-empty">当前筛选没有审核部门身份。</div>';
      return;
    }
    const activeStaff = state.reviewers;
    elements.staffOffboardingList.innerHTML = state.staffDirectory.map((item) => {
      const suspended = item.status === "suspended";
      const self = item.id === state.reviewer?.id;
      const finalLead = item.role === "lead" && state.activeLeadCount <= 1;
      const disabledReason = self
        ? "当前登录身份不能自停用。"
        : finalLead
          ? "最后一名 active 审核负责人不能停用。"
          : "";
      const options = [
        '<option value="">选择案件交接方式</option>',
        '<option value="unassign">受控解除分配，交回公共队列</option>',
        ...activeStaff
          .filter((candidate) => candidate.id !== item.id)
          .map((candidate) => `<option value="reassign:${escapeHtml(candidate.id)}">转派给 ${escapeHtml(candidate.displayName || candidate.username)} · ${escapeHtml(roleName(candidate.role))}</option>`)
      ].join("");
      const controls = suspended
        ? `<div class="tombstone-note"><strong>不可登录 tombstone</strong><span>停用于 ${escapeHtml(formatTime(item.suspendedAt || item.updatedAt))}；历史审核日志与案件处置记录保留。</span></div>`
        : disabledReason
          ? `<div class="tombstone-note protected"><strong>受保护身份</strong><span>${escapeHtml(disabledReason)}</span></div>`
          : `<div class="offboarding-controls"><select data-handoff-target="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.displayName)} 的案件交接方式">${options}</select><input data-reason-target="${escapeHtml(item.id)}" minlength="3" maxlength="500" placeholder="填写不含敏感凭据的离职原因" /><button class="button danger" data-suspend-staff="${escapeHtml(item.id)}" type="button">停用并完成交接</button></div>`;
      return `<article class="staff-offboarding-item ${suspended ? "suspended" : ""}"><div class="staff-identity"><span class="reviewer-avatar">${escapeHtml((item.displayName || item.username || "审").slice(0, 1))}</span><div><strong>${escapeHtml(item.displayName || item.username)}</strong><small>${escapeHtml(item.username)} · ${escapeHtml(roleName(item.role))} · ${suspended ? "已停用" : "active"}</small></div></div><div class="staff-facts"><span>未结案件 <strong>${escapeHtml(item.openCaseCount ?? 0)}</strong></span><span>未撤销会话 <strong>${escapeHtml(item.unrevokedSessionCount ?? 0)}</strong></span><span>最后登录 <strong>${escapeHtml(formatTime(item.lastLoginAt))}</strong></span></div>${controls}</article>`;
    }).join("");
  }

  async function loadStaffOffboarding(page = state.staffFilters.page || 1) {
    if (state.reviewer?.role !== "lead") {
      state.staffDirectory = [];
      state.activeLeadCount = 0;
      return;
    }
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(state.staffFilters.pageSize)
    });
    if (state.staffFilters.keyword) query.set("keyword", state.staffFilters.keyword);
    if (state.staffFilters.status) query.set("status", state.staffFilters.status);
    if (state.staffFilters.role) query.set("role", state.staffFilters.role);
    try {
      const data = await request(`/staff/offboarding?${query.toString()}`);
      const pagination = data.pagination || {
        page,
        pageSize: state.staffFilters.pageSize,
        total: (data.items || []).length,
        totalPages: (data.items || []).length ? 1 : 0
      };
      if (pagination.totalPages > 0 && page > pagination.totalPages) {
        return loadStaffOffboarding(pagination.totalPages);
      }
      state.staffDirectory = data.items || [];
      state.activeLeadCount = Number(data.activeLeadCount || 0);
      state.staffPagination = pagination;
      state.staffFilters.page = pagination.page;
      state.staffError = "";
    } catch (error) {
      state.staffError = error.message || "审核人员目录读取失败";
    }
    renderStaffOffboarding();
  }

  async function suspendReviewStaff(targetReviewerId) {
    if (state.reviewer?.role !== "lead") {
      setFormMessage(elements.staffOffboardingMessage, "仅审核负责人可以执行安全离职。");
      return;
    }
    const handoff = document.querySelector(`[data-handoff-target="${targetReviewerId}"]`)?.value || "";
    const reason = document.querySelector(`[data-reason-target="${targetReviewerId}"]`)?.value?.trim() || "";
    if (!handoff || reason.length < 3) {
      setFormMessage(elements.staffOffboardingMessage, "请选择明确的案件交接方式，并填写至少 3 个字符的离职原因。");
      return;
    }
    const [handoffMode, replacementReviewerId] = handoff.split(":");
    const target = state.staffDirectory.find((item) => item.id === targetReviewerId);
    const targetName = target?.displayName || target?.username || shortId(targetReviewerId);
    if (!window.confirm(`确认停用 ${targetName}？全部审核会话会立即撤销，未结案件会按所选方式交接；历史审计不会删除。`)) {
      return;
    }
    try {
      const result = await request(`/staff/${encodeURIComponent(targetReviewerId)}/suspension`, {
        method: "POST",
        body: JSON.stringify({
          handoffMode,
          ...(replacementReviewerId ? { replacementReviewerId } : {}),
          reason
        })
      });
      setFormMessage(
        elements.staffOffboardingMessage,
        `${targetName} 已停用；撤销 ${result.revokedSessionCount ?? 0} 个会话，交接 ${result.handoff?.reassignedCaseCount ?? 0} 个未结案件。`,
        true
      );
      showToast(`${targetName} 的审核身份已安全停用`);
      await Promise.all([loadStaffOffboarding(), loadReviewers(), loadCases(state.filters.page || 1)]);
      if (state.selectedCaseId) await selectCase(state.selectedCaseId, false, false);
    } catch (error) {
      setFormMessage(elements.staffOffboardingMessage, error.message || "审核人员停用失败");
    }
  }

  async function loadDashboard(selectFirst = true) {
    try {
      const [overview] = await Promise.all([
        request("/overview"),
        loadCases(state.filters.page || 1),
        loadReviewers(),
        loadStaffOffboarding()
      ]);
      state.overview = overview;
      renderOverview();
      renderCaseList();
      elements.lastUpdated.textContent = `更新于 ${formatTime(new Date().toISOString())}`;
      if (selectFirst && !state.selectedCaseId && state.cases.length) await selectCase(state.cases[0].id, true, false);
    } catch (error) {
      showToast(error.message || "审核队列加载失败", true);
      elements.caseList.innerHTML = `<div class="list-empty">无法加载审核队列：${escapeHtml(error.message)}</div>`;
    }
  }

  function showView(target, updateRoute = true) {
    if (!reviewViews.has(target)) {
      renderRouteState(404, "工作区不存在", "请从审核导航重新进入。当前地址不会执行任何业务操作。");
      return;
    }
    if (target === "staff" && state.reviewer?.role !== "lead") {
      if (updateRoute) {
        state.currentView = target;
        writeReviewRoute();
      }
      renderRouteState(403, "无权访问人员交接", "该页面仅对审核负责人开放；普通审核员不能读取或操作人员身份。 ");
      return;
    }
    state.currentView = target;
    const views = {
      workbench: elements.workbenchView,
      labels: elements.labelsView,
      staff: elements.staffView
    };
    Object.entries(views).forEach(([name, element]) => {
      element?.classList.toggle("hidden", name !== target);
    });
    elements.pageTitle.textContent = {
      workbench: "审核工作台",
      labels: "样本标注",
      staff: "人员交接"
    }[target] || "审核工作台";
    if (target === "staff") renderStaffOffboarding();
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.classList.toggle("active", button.dataset.viewTarget === target);
    });
    if (updateRoute) writeReviewRoute();
  }

  async function restoreReviewRoute() {
    const route = parseReviewRoute();
    if (route.invalid) {
      renderRouteState(404, "审核地址不可用", route.reason);
      return;
    }
    applyRouteFilters(route);
    if (route.view === "staff" && state.reviewer?.role !== "lead") {
      showView("staff", false);
      return;
    }
    state.selectedCaseId = route.view === "workbench" && route.caseId ? route.caseId : null;
    state.selectedCase = null;
    showView(route.view, false);
    await loadDashboard(false);
    if (route.view !== "workbench") return;
    if (route.caseId) {
      await selectCase(route.caseId, true, false);
      return;
    }
    if (state.cases.length) {
      await selectCase(state.cases[0].id, true, false);
      writeReviewRoute(true);
    } else {
      elements.caseDetail.className = "case-detail empty-state";
      elements.caseDetail.innerHTML = '<div class="empty-mark" aria-hidden="true">◎</div><h2>当前没有案件</h2><p>可以调整非敏感筛选条件或稍后刷新队列。</p>';
      writeReviewRoute(true);
    }
  }

  async function saveLabel(event) {
    event.preventDefault();
    const text = elements.labelText.value.trim();
    if (!text) {
      setFormMessage(elements.labelMessage, "请填写需要标注的样本文本。");
      return;
    }
    try {
      const data = await request("/labels", {
        method: "POST",
        body: JSON.stringify({
          text,
          expectedDecision: elements.expectedDecision.value,
          actualDecision: elements.actualDecision.value,
          note: elements.labelNote.value.trim() || undefined,
          caseId: state.selectedCaseId || undefined,
          source: state.selectedCase?.source || undefined
        })
      });
      elements.labelForm.reset();
      setFormMessage(elements.labelMessage, `样本已保存。当前共 ${data.count} 条。`, true);
      showToast("审核样本已保存");
      if (state.overview) {
        state.overview.labels = data.count;
        renderOverview();
      }
    } catch (error) {
      setFormMessage(elements.labelMessage, error.message || "样本保存失败");
    }
  }

  async function exportLabels() {
    if (state.reviewer?.role !== "lead") {
      setFormMessage(elements.labelMessage, "仅审核负责人可以分批导出审核样本。");
      return;
    }
    const starting = !state.labelExport.snapshotAt;
    if (starting && !window.confirm("确认开始按固定快照分批导出审核样本吗？每批最多 500 条且单独写入审核审计轨迹，请按最小必要原则保管文件。")) {
      return;
    }
    try {
      elements.exportLabelsButton.disabled = true;
      const query = new URLSearchParams({ limit: "500" });
      if (state.labelExport.snapshotAt) query.set("snapshotAt", state.labelExport.snapshotAt);
      if (state.labelExport.nextCursor) query.set("cursor", state.labelExport.nextCursor);
      const data = await request(`/labels/export?${query.toString()}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const page = state.labelExport.page + 1;
      link.download = `talk-and-talk-review-labels-${data.snapshotAt.slice(0, 10)}-page-${page}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (data.hasMore && data.nextCursor) {
        state.labelExport = { snapshotAt: data.snapshotAt, nextCursor: data.nextCursor, page };
        elements.exportLabelsButton.textContent = `导出下一批（第 ${page + 1} 批）`;
        setFormMessage(elements.labelMessage, `已导出固定快照第 ${page} 批 ${data.pageCount} 条；仍有后续批次。`, true);
      } else {
        state.labelExport = { snapshotAt: "", nextCursor: "", page: 0 };
        elements.exportLabelsButton.textContent = "开始分批导出 JSON（负责人）";
        setFormMessage(elements.labelMessage, `固定快照导出完成；本批 ${data.pageCount} 条。`, true);
      }
      showToast(`已导出第 ${page} 批 ${data.pageCount ?? 0} 条审核样本`);
    } catch (error) {
      setFormMessage(elements.labelMessage, error.message || "样本导出失败");
    } finally {
      elements.exportLabelsButton.disabled = state.reviewer?.role !== "lead";
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const username = document.querySelector("#loginUsername").value.trim();
    const password = document.querySelector("#loginPassword").value;
    const totpCode = document.querySelector("#loginTotp").value.trim();
    if (!username || !password || !/^\d{6}$/.test(totpCode)) {
      setFormMessage(elements.loginMessage, "请填写审核员账号、密码和 6 位动态口令。");
      return;
    }
    elements.loginButton.disabled = true;
    setFormMessage(elements.loginMessage, "正在验证独立审核身份…");
    try {
      const endpoint = apiBase === DEFAULT_REVIEW_API_BASE ? REVIEW_LOGIN_ENDPOINT : `${apiBase}/auth/login`;
      const data = await parseResponse(await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, totpCode })
      }));
      persistSession(data, data.reviewer);
      elements.loginForm.reset();
      setFormMessage(elements.loginMessage, "");
      showPortal();
      await restoreReviewRoute();
    } catch (error) {
      setFormMessage(elements.loginMessage, error.message || "登录失败，请核对审核部门凭据。");
    } finally {
      elements.loginButton.disabled = false;
    }
  }

  async function logout() {
    const token = state.refreshToken;
    try {
      if (token) {
        await request("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: token }) }, false);
      }
    } catch {
      // Local session removal remains correct even if the network is unavailable.
    }
    clearSession();
    showLogin("已退出独立审核会话。");
  }

  function bindEvents() {
    elements.loginForm.addEventListener("submit", handleLogin);
    elements.filterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      state.selectedCaseId = null;
      state.selectedCase = null;
      void loadDashboard(false).then(() => writeReviewRoute());
    });
    elements.refreshButton.addEventListener("click", () => loadDashboard(false));
    document.querySelectorAll("[data-review-logout]").forEach((button) => {
      button.addEventListener("click", () => void logout());
    });
    document.querySelector("#filterResetButton")?.addEventListener("click", () => {
      elements.filterStatus.value = "";
      elements.filterRisk.value = "";
      elements.filterPriority.value = "";
      elements.filterSource.value = "";
      elements.filterKeyword.value = "";
      state.selectedCaseId = null;
      state.selectedCase = null;
      state.filters = { page: 1, pageSize: 50 };
      void loadDashboard(false).then(() => writeReviewRoute());
    });
    elements.labelForm.addEventListener("submit", saveLabel);
    elements.exportLabelsButton.addEventListener("click", exportLabels);
    elements.staffOffboardingList?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-suspend-staff]");
      if (button?.dataset.suspendStaff) void suspendReviewStaff(button.dataset.suspendStaff);
    });
    elements.staffOffboardingPagination?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-staff-page]");
      if (!button || button.disabled) return;
      void loadStaffOffboarding(Number(button.dataset.staffPage || 1));
    });
    elements.staffOffboardingFilterForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.staffFilters.keyword = elements.staffOffboardingKeyword?.value?.trim() || "";
      state.staffFilters.status = elements.staffOffboardingStatus?.value || "";
      state.staffFilters.role = elements.staffOffboardingRole?.value || "";
      void loadStaffOffboarding(1);
    });
    elements.staffHandoffReviewerFilterForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.reviewerQuery.keyword = elements.staffHandoffReviewerKeyword?.value?.trim() || "";
      state.reviewerQuery.role = elements.staffHandoffReviewerRole?.value || "";
      void loadReviewers(1, false);
    });
    elements.staffHandoffReviewerMore?.addEventListener("click", () => {
      if (state.reviewerPagination.page >= state.reviewerPagination.totalPages) return;
      void loadReviewers(state.reviewerPagination.page + 1, true);
    });
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.viewTarget));
    });
    window.addEventListener("popstate", () => {
      if (state.accessToken && state.reviewer) void restoreReviewRoute();
    });
  }

  async function boot() {
    sanitizeLocation();
    bindEvents();
    window.setInterval(() => {
      updateTemporalLabels();
      const remaining = state.accessExpiresAt - Date.now();
      if (state.accessToken && state.refreshToken && remaining <= 60_000) {
        void refreshSession();
      }
    }, 30_000);
    if (!state.accessToken || !state.refreshToken || !state.reviewer) {
      showLogin();
      return;
    }
    if (!state.accessExpiresAt) {
      state.accessExpiresAt = parseJwtExpiry(state.accessToken);
      sessionStorage.setItem(storageKeys.accessExpiresAt, String(state.accessExpiresAt));
    }
    try {
      const data = await request("/auth/me");
      state.reviewer = data.reviewer;
      sessionStorage.setItem(storageKeys.reviewer, JSON.stringify(state.reviewer));
      showPortal();
      await restoreReviewRoute();
    } catch {
      clearSession();
      showLogin("审核会话已失效，请重新登录。");
    }
  }

  void boot();
})();
