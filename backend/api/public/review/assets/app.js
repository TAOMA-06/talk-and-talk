(() => {
  "use strict";

  const DEFAULT_REVIEW_API_BASE = "/api/v1/review";
  const REVIEW_LOGIN_ENDPOINT = "/api/v1/review/auth/login";
  const apiBase = window.REVIEW_API_BASE_URL || DEFAULT_REVIEW_API_BASE;
  const storageKeys = {
    access: "talk_and_talk_review_access_token",
    refresh: "talk_and_talk_review_refresh_token",
    reviewer: "talk_and_talk_review_identity"
  };
  const state = {
    accessToken: sessionStorage.getItem(storageKeys.access) || "",
    refreshToken: sessionStorage.getItem(storageKeys.refresh) || "",
    reviewer: parseStoredReviewer(),
    overview: null,
    cases: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
    selectedCaseId: null,
    selectedCase: null,
    filters: { page: 1, pageSize: 50 }
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

  const elements = {
    loginView: document.querySelector("#loginView"),
    portalView: document.querySelector("#portalView"),
    loginForm: document.querySelector("#loginForm"),
    loginButton: document.querySelector("#loginButton"),
    loginMessage: document.querySelector("#loginMessage"),
    reviewerName: document.querySelector("#reviewerName"),
    reviewerRole: document.querySelector("#reviewerRole"),
    reviewerInitials: document.querySelector("#reviewerInitials"),
    logoutButton: document.querySelector("#logoutButton"),
    refreshButton: document.querySelector("#refreshButton"),
    lastUpdated: document.querySelector("#lastUpdated"),
    pageTitle: document.querySelector("#pageTitle"),
    workbenchView: document.querySelector("#workbenchView"),
    labelsView: document.querySelector("#labelsView"),
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
    sessionStorage.setItem(storageKeys.access, state.accessToken);
    sessionStorage.setItem(storageKeys.refresh, state.refreshToken);
    sessionStorage.setItem(storageKeys.reviewer, JSON.stringify(reviewer));
  }

  function clearSession() {
    state.accessToken = "";
    state.refreshToken = "";
    state.reviewer = null;
    state.selectedCaseId = null;
    state.selectedCase = null;
    sessionStorage.removeItem(storageKeys.access);
    sessionStorage.removeItem(storageKeys.refresh);
    sessionStorage.removeItem(storageKeys.reviewer);
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
      if (error.status === 401 && allowRefresh && state.refreshToken && !path.includes("/auth/")) {
        const refreshed = await refreshSession();
        if (refreshed) return request(path, options, false);
      }
      throw error;
    }
  }

  async function refreshSession() {
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
      return `
        <button class="case-card ${active}" type="button" data-case-id="${escapeHtml(item.id)}">
          <div class="case-card-top">${tag(item.priority || "normal", item.priority === "critical" ? "紧急" : item.priority === "high" ? "高优先级" : "普通")} ${tag(item.riskLevel, riskName(item.riskLevel))}</div>
          <h3>${escapeHtml(item.title || "未命名案件")}</h3>
          <p>${escapeHtml(item.content || "无文本内容")}</p>
          <div class="case-card-meta"><span>${escapeHtml(sourceName(item.source))} · ${escapeHtml(statusName(item.status))}</span><time>${escapeHtml(formatTime(item.createdAt))}</time></div>
        </button>`;
    }).join("");
    elements.caseList.querySelectorAll("[data-case-id]").forEach((button) => {
      button.addEventListener("click", () => selectCase(button.dataset.caseId));
    });
    renderPagination();
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
        if (next >= 1 && next <= totalPages) loadCases(next);
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

  function renderCaseDetail(result) {
    const item = result.case;
    state.selectedCase = item;
    const open = ["pending", "autoReviewing", "humanReview"].includes(item.status);
    const evidence = (item.evidences || []).map((entry) => `
      <article class="evidence-item"><strong>${escapeHtml(entry.type || "evidence")}</strong><pre>${escapeHtml(jsonPreview(entry.payload))}</pre></article>`).join("") || '<p class="muted">没有附加证据。</p>';
    const appeals = (item.appeals || []).map((appeal) => `
      <article class="log-item"><span class="log-dot"></span><div><strong>申诉 · ${escapeHtml(appeal.status || "pending")}</strong><p>${escapeHtml(appeal.reason || "无申诉说明")}</p><small>${escapeHtml(formatTime(appeal.createdAt))}</small></div></article>`).join("") || "";
    const logs = (item.actionLog || []).map((log) => `
      <article class="log-item"><span class="log-dot"></span><div><strong>${escapeHtml(actionLabels[log.action] || log.action)}</strong><p>${escapeHtml(log.note || "未填写处置说明")}</p><small>审核员：${escapeHtml(shortId(log.reviewerId || log.actorId))} · ${escapeHtml(formatTime(log.createdAt))}</small></div></article>`).join("") || '<p class="muted">尚无人工处置记录。</p>';
    const actions = open ? renderActionButtons(item) : '<p class="muted">该案件已经结案。所有历史判断与证据均保留在本部门审计轨迹中。</p>';
    elements.caseDetail.className = "case-detail";
    elements.caseDetail.innerHTML = `
      <header class="case-header">
        <div><p class="eyebrow">${escapeHtml(sourceName(item.source))} · ${escapeHtml(statusName(item.status))}</p><h2>${escapeHtml(item.title || "未命名案件")}</h2><p class="case-id">案件 ${escapeHtml(item.id)}</p></div>
        <div>${tag(item.priority || "normal", item.priority === "critical" ? "紧急" : item.priority === "high" ? "高优先级" : "普通")} ${tag(item.riskLevel || "low", riskName(item.riskLevel))}</div>
      </header>
      <section class="case-section"><h3>待审内容</h3><p class="case-content">${escapeHtml(item.content || "无可展示文本")}</p><div class="source-chips"><span class="tag">模型：${escapeHtml(item.provider || "规则引擎")}</span><span class="tag">策略：${escapeHtml(item.policyVersion || "—")}</span><span class="tag">风险分：${escapeHtml(item.aiScore ?? "—")}</span></div></section>
      <section class="case-section"><h3>判断摘要</h3><div class="detail-metadata"><div><span>初始结论</span><strong>${escapeHtml(item.decision || "—")}</strong></div><div><span>模型理由</span><strong title="${escapeHtml(item.aiReason || "—")}">${escapeHtml(item.aiReason || "—")}</strong></div><div><span>创建时间</span><strong>${escapeHtml(formatTime(item.createdAt))}</strong></div></div></section>
      <section class="case-section"><h3>案件证据</h3><div class="evidence-list">${evidence}</div></section>
      <section class="case-section"><h3>会话上下文</h3><div id="conversationEvidence" class="message-list"><p class="muted">正在请求最小必要会话上下文…</p></div></section>
      ${appeals ? `<section class="case-section"><h3>用户申诉</h3><div class="log-list">${appeals}</div></section>` : ""}
      <section class="case-section"><h3>处置轨迹</h3><div class="log-list">${logs}</div></section>
      <section class="case-section"><div class="action-shell"><h3>提交审核判断</h3><p>高风险处置必须写明理由；限言仅限审核负责人执行。提交后业务侧仅接收该条受控决策。</p><textarea id="actionNote" class="action-note" maxlength="1000" placeholder="填写审核依据、上下文或申诉裁决理由"></textarea><div class="action-grid">${actions}</div></div></section>`;
    elements.caseDetail.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => submitAction(button.dataset.action));
    });
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
    return actions.map(([action, label, classes]) => `<button class="button ${classes}" type="button" data-action="${action}">${label}</button>`).join("");
  }

  async function loadConversation(caseId) {
    const container = document.querySelector("#conversationEvidence");
    if (!container) return;
    try {
      const data = await request(`/cases/${encodeURIComponent(caseId)}/conversation`);
      if (state.selectedCaseId !== caseId) return;
      if (!data.conversation || !data.messages?.length) {
        container.innerHTML = '<p class="muted">此案件没有可展示的会话上下文。</p>';
        return;
      }
      container.innerHTML = data.messages.map((message) => `
        <article class="message-item"><strong>${escapeHtml(message.senderName || shortId(message.senderId))} <span class="tag ${escapeHtml(message.moderationStatus || "pending")}">${escapeHtml(message.moderationStatus || "未知状态")}</span></strong><p>${escapeHtml(message.content || "（非文本或空消息）")}</p><small>${escapeHtml(formatTime(message.timestamp))}</small></article>`).join("");
    } catch (error) {
      container.innerHTML = `<p class="muted">无法加载会话证据：${escapeHtml(error.message)}</p>`;
    }
  }

  async function submitAction(action) {
    const note = document.querySelector("#actionNote")?.value?.trim() || "";
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
      if (state.selectedCaseId) await selectCase(state.selectedCaseId, false);
    } catch (error) {
      showToast(error.message || "处置未能提交", true);
    }
  }

  async function selectCase(id, renderLoading = true) {
    state.selectedCaseId = id;
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
      state.selectedCaseId = null;
      state.selectedCase = null;
      elements.caseDetail.className = "case-detail empty-state";
      elements.caseDetail.innerHTML = '<div class="empty-mark" aria-hidden="true">◎</div><h2>选择一条工单</h2><p>当前筛选未包含上次打开的案件。</p>';
    }
    renderCaseList();
  }

  async function loadDashboard(selectFirst = true) {
    try {
      const [overview] = await Promise.all([request("/overview"), loadCases(state.filters.page || 1)]);
      state.overview = overview;
      renderOverview();
      elements.lastUpdated.textContent = `更新于 ${formatTime(new Date().toISOString())}`;
      if (selectFirst && !state.selectedCaseId && state.cases.length) await selectCase(state.cases[0].id);
    } catch (error) {
      showToast(error.message || "审核队列加载失败", true);
      elements.caseList.innerHTML = `<div class="list-empty">无法加载审核队列：${escapeHtml(error.message)}</div>`;
    }
  }

  function showView(target) {
    const isWorkbench = target === "workbench";
    elements.workbenchView.classList.toggle("hidden", !isWorkbench);
    elements.labelsView.classList.toggle("hidden", isWorkbench);
    elements.pageTitle.textContent = isWorkbench ? "审核工作台" : "样本标注";
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.classList.toggle("active", button.dataset.viewTarget === target);
    });
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
    try {
      const data = await request("/labels/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `talk-and-talk-review-labels-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(`已导出 ${data.count ?? 0} 条审核样本`);
    } catch (error) {
      setFormMessage(elements.labelMessage, error.message || "样本导出失败");
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
      await loadDashboard();
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
      loadDashboard(false);
    });
    elements.refreshButton.addEventListener("click", () => loadDashboard(false));
    elements.logoutButton.addEventListener("click", logout);
    elements.labelForm.addEventListener("submit", saveLabel);
    elements.exportLabelsButton.addEventListener("click", exportLabels);
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.viewTarget));
    });
  }

  async function boot() {
    bindEvents();
    if (!state.accessToken || !state.refreshToken || !state.reviewer) {
      showLogin();
      return;
    }
    try {
      const data = await request("/auth/me");
      state.reviewer = data.reviewer;
      sessionStorage.setItem(storageKeys.reviewer, JSON.stringify(state.reviewer));
      showPortal();
      await loadDashboard();
    } catch {
      clearSession();
      showLogin("审核会话已失效，请重新登录。");
    }
  }

  void boot();
})();
