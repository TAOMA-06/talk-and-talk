import { createReadStream, existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import crypto from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const publicDir = join(rootDir, "public");

const DEFAULT_PORT = 8787;
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "jia:latest";
const VALID_DECISIONS = new Set(["allow", "review", "warn", "block"]);
const VALID_SOURCES = new Set(["chat", "community", "report", "profile"]);
const VALID_ADMIN_ACTIONS = new Set(["confirmViolation", "dismiss", "escalate"]);

const violationExamples = [
  {
    id: "ex-contact",
    title: "引导私下联系",
    source: "chat",
    sampleText: "我们加微信聊吧，平台里说话太麻烦了。",
    expectedDecision: "block",
    riskLevel: "high",
    matchedRules: ["contact.wechat"],
    reviewerHint: "明确要求脱离平台，直接拦截并提醒用户保持平台内沟通。"
  },
  {
    id: "ex-offline",
    title: "线下邀约",
    source: "chat",
    sampleText: "今晚线下见个面吧，我订个酒店。",
    expectedDecision: "block",
    riskLevel: "high",
    matchedRules: ["contact.offline", "sexual.explicit"],
    reviewerHint: "陪伴服务只允许线上沟通，线下邀约和酒店暗示需要确认违规。"
  },
  {
    id: "ex-transfer",
    title: "私下交易",
    source: "chat",
    sampleText: "你把收款码发我，我私下给你转账。",
    expectedDecision: "block",
    riskLevel: "high",
    matchedRules: ["finance.transfer"],
    reviewerHint: "涉及私下资金往来，需拦截并保留工单记录。"
  },
  {
    id: "ex-privacy",
    title: "索要隐私",
    source: "chat",
    sampleText: "告诉我你的真实姓名和住址，我去找你。",
    expectedDecision: "warn",
    riskLevel: "medium",
    matchedRules: ["privacy.request"],
    reviewerHint: "涉及隐私索取，通常先提醒；若叠加线下意图可升级人工。"
  },
  {
    id: "ex-ad",
    title: "广告引流",
    source: "community",
    sampleText: "兼职赚钱，代理推广，加我了解详情。",
    expectedDecision: "review",
    riskLevel: "low",
    matchedRules: ["ads.promo"],
    reviewerHint: "社区内容疑似广告，默认进入复核，不直接发布。"
  },
  {
    id: "ex-normal",
    title: "正常倾诉",
    source: "chat",
    sampleText: "今天工作压力很大，想找人认真听我说完。",
    expectedDecision: "allow",
    riskLevel: "low",
    matchedRules: [],
    reviewerHint: "正常情绪支持场景，应放行。"
  }
];

class AppError extends Error {
  constructor(code, message, statusCode = 400, details) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestId() {
  return crypto.randomUUID();
}

function jsonResponse(res, statusCode, requestIdValue, payload) {
  const body = JSON.stringify({
    ...payload,
    meta: {
      timestamp: nowIso(),
      requestId: requestIdValue
    }
  });

  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(body);
}

function sendData(res, statusCode, requestIdValue, data) {
  jsonResponse(res, statusCode, requestIdValue, { data });
}

function sendError(res, requestIdValue, error) {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof AppError ? error.message : "Unexpected server error";
  const details = error instanceof AppError ? error.details : undefined;

  if (!(error instanceof AppError)) {
    console.error(`[${requestIdValue}] Unexpected error`, error);
  }

  jsonResponse(res, statusCode, requestIdValue, {
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

function initialState() {
  const baseTime = Date.now();

  return {
    users: [
      {
        id: "u1",
        name: "小楷",
        initials: "小楷",
        role: "customer",
        safetyScore: 72,
        isVerified: false
      }
    ],
    companions: [
      {
        id: "c1",
        name: "林屿",
        initials: "LY",
        role: "温柔倾听者",
        specialties: ["情绪倾听", "睡前语音"],
        responseTime: "约30秒",
        availability: "online"
      },
      {
        id: "c2",
        name: "许澈",
        initials: "XC",
        role: "职场沟通陪伴",
        specialties: ["职场减压", "学习陪伴"],
        responseTime: "约1分钟",
        availability: "available"
      }
    ],
    conversations: [
      {
        id: "c1",
        title: "林屿",
        participantId: "c1",
        participantName: "林屿",
        participantRole: "温柔倾听者",
        customerName: "小楷",
        status: "active",
        createdAt: new Date(baseTime - 86_400_000).toISOString()
      },
      {
        id: "c2",
        title: "许澈",
        participantId: "c2",
        participantName: "许澈",
        participantRole: "职场沟通陪伴",
        customerName: "李四",
        status: "active",
        createdAt: new Date(baseTime - 3_600_000).toISOString()
      },
      {
        id: "c3",
        title: "周映",
        participantId: "c3",
        participantName: "周映",
        participantRole: "睡前声音陪伴",
        customerName: "王五",
        status: "flagged",
        createdAt: new Date(baseTime - 7_200_000).toISOString()
      }
    ],
    messages: [
      {
        id: "m1",
        conversationId: "c1",
        senderId: "system",
        senderName: "系统",
        content: "平台已开启安全提醒：请勿交换私人联系方式或进行线下邀约。",
        type: "system",
        timestamp: new Date(baseTime - 720_000).toISOString()
      },
      {
        id: "m2",
        conversationId: "c1",
        senderId: "c1",
        senderName: "林屿",
        content: "晚上好，我是林屿。你可以从任何一个小片段开始说。",
        type: "text",
        timestamp: new Date(baseTime - 680_000).toISOString()
      },
      {
        id: "m3",
        conversationId: "c1",
        senderId: "u1",
        senderName: "小楷",
        content: "今天有点累，感觉脑子里都是工作的事。",
        type: "text",
        timestamp: new Date(baseTime - 610_000).toISOString()
      },
      {
        id: "m4",
        conversationId: "c1",
        senderId: "c1",
        senderName: "林屿",
        content: "那我们先不急着解决。你觉得最压着你的，是事情多，还是没人理解？",
        type: "text",
        timestamp: new Date(baseTime - 560_000).toISOString()
      },
      {
        id: "m5",
        conversationId: "c2",
        senderId: "system",
        senderName: "系统",
        content: "订单已由平台担保，沟通开始前请勿交换私人联系方式。",
        type: "system",
        timestamp: new Date(baseTime - 3_200_000).toISOString()
      },
      {
        id: "m6",
        conversationId: "c3",
        senderId: "u3",
        senderName: "王五",
        content: "今晚线下见个面吧，我订个酒店。",
        type: "text",
        timestamp: new Date(baseTime - 1_800_000).toISOString(),
        moderation: {
          decision: "block",
          score: 0.95,
          reasons: ["疑似线下邀约", "疑似低俗或越界内容"],
          usedAI: false
        }
      },
      {
        id: "m7",
        conversationId: "c3",
        senderId: "system",
        senderName: "系统",
        content: "安全提醒：平台不支持线下邀约、私下转账或交换私人联系方式，请在平台内完成沟通。",
        type: "safety",
        timestamp: new Date(baseTime - 1_799_000).toISOString()
      }
    ],
    moderationCases: [
      {
        id: "mc1",
        title: "聊天拦截：线下见面 + 酒店暗示",
        category: "内容风控",
        riskLevel: "high",
        status: "humanReview",
        source: "chat",
        content: "今晚线下见个面吧，我订个酒店。",
        targetId: "c3",
        reporter: "system",
        userName: "王五",
        aiScore: 0.95,
        aiReason: "疑似线下邀约；疑似低俗或越界内容",
        decision: "block",
        matchedRules: ["contact.offline", "sexual.explicit"],
        usedAI: false,
        createdAt: new Date(baseTime - 1_790_000).toISOString(),
        resolvedAt: null,
        actionLog: []
      },
      {
        id: "mc2",
        title: "聊天预警：索要真实姓名和住址",
        category: "实时风控",
        riskLevel: "medium",
        status: "pending",
        source: "chat",
        content: "你在哪，告诉我真实姓名和住址。",
        targetId: "c1",
        reporter: "system",
        userName: "小楷",
        aiScore: 0.58,
        aiReason: "疑似索要隐私信息",
        decision: "warn",
        matchedRules: ["privacy.request"],
        usedAI: false,
        createdAt: new Date(baseTime - 4_200_000).toISOString(),
        resolvedAt: null,
        actionLog: []
      },
      {
        id: "mc3",
        title: "社区内容：兼职代理推广",
        category: "社区审核",
        riskLevel: "low",
        status: "autoReviewing",
        source: "community",
        content: "兼职赚钱，代理推广，加我了解详情。",
        targetId: "p-demo-1",
        reporter: "system",
        userName: "陈墨",
        aiScore: 0.42,
        aiReason: "疑似广告或引流",
        decision: "review",
        matchedRules: ["ads.promo"],
        usedAI: false,
        createdAt: new Date(baseTime - 3_900_000).toISOString(),
        resolvedAt: null,
        actionLog: []
      },
      {
        id: "mc4",
        title: "资料审核：头像人脸核验缺失",
        category: "资料审核",
        riskLevel: "low",
        status: "pending",
        source: "profile",
        content: "头像与实名资料不一致，需补充活体核验。",
        targetId: "c5",
        reporter: "profile.audit",
        userName: "闻舟",
        aiScore: 0.2,
        aiReason: "资料待补充",
        decision: "review",
        matchedRules: ["profile.pending"],
        usedAI: false,
        createdAt: new Date(baseTime - 5_400_000).toISOString(),
        resolvedAt: null,
        actionLog: []
      }
    ],
    labels: []
  };
}

let state = initialState();

function resetState() {
  state = initialState();
  return state;
}

const blockRules = [
  {
    id: "contact.wechat",
    patterns: ["加微信", "加v", "加V", "vx", "wx", "v信", "薇信", "微信号", "私加"],
    score: 0.92,
    reason: "疑似引导私下联系"
  },
  {
    id: "contact.offline",
    patterns: ["线下", "见面", "见个面", "出来见", "酒店", "宾馆"],
    score: 0.9,
    reason: "疑似线下邀约"
  },
  {
    id: "finance.transfer",
    patterns: ["转账", "打款", "红包", "支付宝", "收款码"],
    score: 0.93,
    reason: "疑似私下交易"
  },
  {
    id: "sexual.explicit",
    patterns: ["裸聊", "色情", "开房"],
    score: 0.95,
    reason: "疑似低俗或越界内容"
  }
];

const warnRules = [
  {
    id: "harass.pua",
    patterns: ["听话", "乖一点", "别装", "你不行"],
    score: 0.62,
    reason: "疑似不尊重或 PUA 表达"
  },
  {
    id: "privacy.request",
    patterns: ["住址", "身份证", "真实姓名", "你在哪"],
    score: 0.58,
    reason: "疑似索要隐私信息"
  },
  {
    id: "offline.implicit",
    patterns: ["今晚见", "能不能见", "出来聊"],
    score: 0.6,
    reason: "疑似变相线下邀约"
  }
];

const reviewRules = [
  {
    id: "ads.promo",
    patterns: ["代理", "兼职赚钱", "加我了解", "推广"],
    score: 0.42,
    reason: "疑似广告或引流"
  },
  {
    id: "conflict.bait",
    patterns: ["滚", "废物", "傻"],
    score: 0.38,
    reason: "疑似引战或攻击性表达"
  }
];

function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replaceAll(" ", "")
    .replaceAll("　", "")
    .replaceAll("＋", "+")
    .replaceAll("vx", "微信")
    .replaceAll("wx", "微信")
    .replaceAll("加v", "加微")
    .replaceAll("薇", "微")
    .replaceAll("v", "微");
}

function decisionForScore(score) {
  if (score >= 0.85) return "block";
  if (score >= 0.55) return "warn";
  if (score >= 0.35) return "review";
  return "allow";
}

function riskLevelForScore(score) {
  if (score >= 0.85) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function moderationResult(score, reasons, matchedRules, usedAI, extras = {}) {
  const roundedScore = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  return {
    decision: decisionForScore(roundedScore),
    riskLevel: riskLevelForScore(roundedScore),
    score: roundedScore,
    reasons,
    matchedRules,
    usedAI,
    ...extras
  };
}

function ruleBasedModeration(text, source = "chat", context = {}) {
  const normalized = normalizeText(text);
  const reasons = [];
  const matchedRules = [];
  let score = 0;

  for (const rule of [...blockRules, ...warnRules, ...reviewRules]) {
    const matched = rule.patterns.some((pattern) => {
      return normalized.includes(normalizeText(pattern));
    });

    if (matched) {
      score = Math.max(score, rule.score);
      reasons.push(rule.reason);
      matchedRules.push(rule.id);
    }
  }

  const recentMessages = Array.isArray(context.recentMessages) ? context.recentMessages : [];
  if (recentMessages.length > 0) {
    const riskyHistory = recentMessages.slice(-2).filter((message) => {
      return ruleBasedModeration(message, "chat", {}).score >= 0.35;
    });
    const currentScore = score;
    if (riskyHistory.length > 0 && currentScore >= 0.35) {
      score = Math.max(score, Math.min(1, currentScore + 0.15));
      reasons.push("近期会话存在连续风险表达");
      matchedRules.push("context.accumulation");
    }
  }

  if (source === "community" && (normalized.includes("广告") || normalized.includes("引流"))) {
    score = Math.max(score, 0.7);
    reasons.push("社区内容疑似广告引流");
    matchedRules.push("community.ads");
  }

  if (reasons.length === 0) {
    return moderationResult(0.05, ["内容正常"], [], false, {
      engine: "rules"
    });
  }

  return moderationResult(score, [...new Set(reasons)], matchedRules, false, {
    engine: "rules"
  });
}

function categoryForSource(source) {
  switch (source) {
    case "community":
      return "社区审核";
    case "report":
      return "用户举报";
    case "profile":
      return "资料审核";
    case "chat":
    default:
      return "实时风控";
  }
}

function messagesForConversation(conversationId) {
  return state.messages
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function recentUserText(conversationId) {
  return messagesForConversation(conversationId)
    .filter((message) => message.senderId === "u1" && message.type === "text")
    .slice(-4)
    .map((message) => message.content);
}

function findConversation(conversationId) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    throw new AppError("NOT_FOUND", `Conversation ${conversationId} was not found`, 404);
  }
  return conversation;
}

function publicConversation(conversation) {
  const messages = messagesForConversation(conversation.id);
  const lastMessage = messages.at(-1) ?? null;
  const caseCount = state.moderationCases.filter((item) => item.targetId === conversation.id).length;
  return {
    ...conversation,
    lastMessage,
    messageCount: messages.length,
    moderationCaseCount: caseCount
  };
}

function pendingCaseCount() {
  return state.moderationCases.filter((item) => {
    return item.status === "pending" || item.status === "autoReviewing" || item.status === "humanReview";
  }).length;
}

function overviewStats() {
  const cases = state.moderationCases;
  const blocked = cases.filter((item) => item.decision === "block").length;
  const warned = cases.filter((item) => item.decision === "warn").length;
  const reviewed = cases.filter((item) => item.decision === "review").length;
  const resolved = cases.filter((item) => item.status === "resolved" || item.status === "dismissed").length;
  const bySource = Object.fromEntries([...VALID_SOURCES].map((source) => [
    source,
    cases.filter((item) => item.source === source).length
  ]));
  const byRisk = {
    high: cases.filter((item) => item.riskLevel === "high").length,
    medium: cases.filter((item) => item.riskLevel === "medium").length,
    low: cases.filter((item) => item.riskLevel === "low").length
  };

  return {
    pendingCases: pendingCaseCount(),
    totalCases: cases.length,
    blocked,
    warned,
    reviewed,
    resolved,
    activeConversations: state.conversations.length,
    labels: state.labels.length,
    bySource,
    byRisk
  };
}

function createModerationCase({ result, title, source, content, targetId, status }) {
  const item = {
    id: `mc-${crypto.randomUUID()}`,
    title,
    category: categoryForSource(source),
    riskLevel: result.riskLevel,
    status,
    source,
    content,
    targetId,
    aiScore: result.score,
    aiReason: result.reasons.join("；"),
    decision: result.decision,
    matchedRules: result.matchedRules,
    usedAI: result.usedAI,
    createdAt: nowIso(),
    resolvedAt: null,
    actionLog: []
  };
  state.moderationCases.unshift(item);
  return item;
}

function findModerationCase(caseId) {
  const item = state.moderationCases.find((entry) => entry.id === caseId);
  if (!item) {
    throw new AppError("NOT_FOUND", `Moderation case ${caseId} was not found`, 404);
  }
  return item;
}

function applyAdminAction(caseId, action, note = "") {
  if (!VALID_ADMIN_ACTIONS.has(action)) {
    throw new AppError("VALIDATION_ERROR", "action is invalid", 422, {
      allowed: [...VALID_ADMIN_ACTIONS]
    });
  }

  const item = findModerationCase(caseId);
  const logEntry = {
    id: `action-${crypto.randomUUID()}`,
    action,
    note,
    operator: "demo-admin",
    createdAt: nowIso()
  };

  if (action === "confirmViolation") {
    item.status = "resolved";
    item.resolvedAt = nowIso();
  }
  if (action === "dismiss") {
    item.status = "dismissed";
    item.resolvedAt = nowIso();
  }
  if (action === "escalate") {
    item.status = "humanReview";
    item.resolvedAt = null;
  }

  item.actionLog = Array.isArray(item.actionLog) ? item.actionLog : [];
  item.actionLog.unshift(logEntry);

  return {
    case: item,
    action: logEntry,
    overview: overviewStats()
  };
}

function systemMessage(conversationId, content, type = "safety") {
  const message = {
    id: `m-${crypto.randomUUID()}`,
    conversationId,
    senderId: "system",
    senderName: "系统",
    content,
    type,
    timestamp: nowIso()
  };
  state.messages.push(message);
  return message;
}

function userMessage(conversationId, senderId, content, result) {
  const user = state.users.find((item) => item.id === senderId);
  const message = {
    id: `m-${crypto.randomUUID()}`,
    conversationId,
    senderId,
    senderName: user?.name ?? senderId,
    content,
    type: "text",
    timestamp: nowIso(),
    moderation: {
      decision: result.decision,
      score: result.score,
      reasons: result.reasons,
      usedAI: result.usedAI
    }
  };
  state.messages.push(message);
  return message;
}

function companionReply(conversation) {
  const replies = [
    "我在，先慢慢说。我们可以把现在最困扰你的点拆成一小步一小步看。",
    "听起来你今天消耗很大。要不要先做一个30秒呼吸放松，再继续聊？",
    `谢谢你愿意说出来。${conversation.participantName}会跟着你的节奏，不急着给结论。`,
    "我会保持边界和尊重，如果有任何不舒服，可以随时结束或举报。"
  ];
  const content = replies[Math.floor(Math.random() * replies.length)] ?? replies[0];
  const message = {
    id: `m-${crypto.randomUUID()}`,
    conversationId: conversation.id,
    senderId: conversation.participantId,
    senderName: conversation.participantName,
    content,
    type: "text",
    timestamp: nowIso()
  };
  state.messages.push(message);
  return message;
}

function parseOllamaJson(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

async function checkOllama({ ollamaUrl, model, disableOllama }) {
  if (disableOllama) {
    return {
      connected: false,
      model,
      reason: "disabled"
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        connected: false,
        model,
        reason: `http_${response.status}`
      };
    }

    const body = await response.json();
    const models = Array.isArray(body.models) ? body.models.map((item) => item.name) : [];
    return {
      connected: true,
      model,
      modelAvailable: models.includes(model),
      availableModels: models
    };
  } catch (error) {
    return {
      connected: false,
      model,
      reason: error.name === "AbortError" ? "timeout" : "unavailable"
    };
  }
}

async function ollamaModeration({ text, source, ruleResult, ollamaUrl, model, disableOllama }) {
  if (disableOllama || ruleResult.decision === "block") {
    return null;
  }

  const prompt = [
    "你是 Talk&Talk 本地内容安全审查模型，只输出 JSON。",
    "平台只允许线上陪伴沟通，禁止私联、线下邀约、私下交易、骚扰、低俗内容、广告引流。",
    "请按 0 到 1 输出 riskScore，并给出 1 到 3 条中文 reasons。",
    "阈值参考：0.85 block，0.55 warn，0.35 review，低于 0.35 allow。",
    "JSON schema: {\"riskScore\": number, \"reasons\": string[], \"matchedRules\": string[]}",
    `source: ${source}`,
    `text: ${text}`
  ].join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0,
          num_ctx: 2048
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        error: `ollama_http_${response.status}`
      };
    }

    const body = await response.json();
    const parsed = parseOllamaJson(body.response);
    if (!parsed || typeof parsed.riskScore !== "number") {
      return {
        error: "ollama_invalid_json"
      };
    }

    const aiScore = Math.max(0, Math.min(1, parsed.riskScore));
    const reasons = Array.isArray(parsed.reasons) && parsed.reasons.length > 0
      ? parsed.reasons.map(String).slice(0, 3)
      : ["本地模型识别到潜在风险"];
    const matchedRules = Array.isArray(parsed.matchedRules)
      ? parsed.matchedRules.map(String).slice(0, 5)
      : [];

    return moderationResult(aiScore, reasons, [`ollama.${model}`, ...matchedRules], true, {
      engine: "ollama",
      model
    });
  } catch (error) {
    return {
      error: error.name === "AbortError" ? "ollama_timeout" : "ollama_unavailable"
    };
  }
}

async function moderateText(text, {
  source = "chat",
  conversationId = null,
  ollamaUrl = DEFAULT_OLLAMA_URL,
  model = DEFAULT_OLLAMA_MODEL,
  disableOllama = false
} = {}) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new AppError("VALIDATION_ERROR", "text is required", 422, {
      field: "text"
    });
  }

  if (!VALID_SOURCES.has(source)) {
    throw new AppError("VALIDATION_ERROR", "source is invalid", 422, {
      allowed: [...VALID_SOURCES]
    });
  }

  const context = {
    recentMessages: conversationId ? recentUserText(conversationId) : []
  };
  const ruleResult = ruleBasedModeration(text.trim(), source, context);
  const aiResult = await ollamaModeration({
    text: text.trim(),
    source,
    ruleResult,
    ollamaUrl,
    model,
    disableOllama
  });

  if (!aiResult || aiResult.error) {
    return {
      ...ruleResult,
      aiStatus: aiResult?.error ?? (disableOllama ? "disabled" : "skipped")
    };
  }

  const mergedScore = Math.max(ruleResult.score, aiResult.score);
  return moderationResult(
    mergedScore,
    [...new Set([...ruleResult.reasons, ...aiResult.reasons])],
    [...ruleResult.matchedRules, ...aiResult.matchedRules],
    true,
    {
      engine: "hybrid",
      model,
      ruleScore: ruleResult.score,
      aiScore: aiResult.score
    }
  );
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
}

function route(method, pathname) {
  if (method === "GET" && pathname === "/api/health") {
    return { name: "health", params: {} };
  }
  if (method === "GET" && pathname === "/api/admin/overview") {
    return { name: "adminOverview", params: {} };
  }
  if (method === "GET" && pathname === "/api/conversations") {
    return { name: "listConversations", params: {} };
  }
  if (method === "GET") {
    const match = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (match) return { name: "listMessages", params: { conversationId: decodeURIComponent(match[1]) } };
  }
  if (method === "POST") {
    const match = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (match) return { name: "sendMessage", params: { conversationId: decodeURIComponent(match[1]) } };
  }
  if (method === "POST" && pathname === "/api/moderate") {
    return { name: "moderate", params: {} };
  }
  if (method === "GET" && pathname === "/api/moderation-cases") {
    return { name: "listModerationCases", params: {} };
  }
  if (method === "POST") {
    const match = pathname.match(/^\/api\/moderation-cases\/([^/]+)\/actions$/);
    if (match) return { name: "caseAction", params: { caseId: decodeURIComponent(match[1]) } };
  }
  if (method === "GET" && pathname === "/api/violation-examples") {
    return { name: "listViolationExamples", params: {} };
  }
  if (method === "POST" && pathname === "/api/labels") {
    return { name: "createLabel", params: {} };
  }
  if (method === "GET" && pathname === "/api/labels/export") {
    return { name: "exportLabels", params: {} };
  }
  if (method === "POST" && pathname === "/api/reset") {
    return { name: "reset", params: {} };
  }
  return null;
}

function contentTypeForPath(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, requested));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    throw new AppError("NOT_FOUND", "Route not found", 404);
  }

  res.writeHead(200, {
    "content-type": contentTypeForPath(filePath),
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

async function handleApi({ req, res, routeMatch, requestIdValue, config }) {
  switch (routeMatch.name) {
    case "health": {
      const ollama = await checkOllama(config);
      sendData(res, 200, requestIdValue, {
        status: "ok",
        service: "Talk&Talk BackendDemo",
        uptimeSeconds: Math.round(process.uptime()),
        ollama
      });
      return;
    }
    case "adminOverview": {
      sendData(res, 200, requestIdValue, {
        overview: overviewStats(),
        queue: state.moderationCases.slice(0, 8)
      });
      return;
    }
    case "listConversations": {
      sendData(res, 200, requestIdValue, {
        conversations: state.conversations.map(publicConversation)
      });
      return;
    }
    case "listMessages": {
      const { conversationId } = routeMatch.params;
      const conversation = findConversation(conversationId);
      sendData(res, 200, requestIdValue, {
        conversation: publicConversation(conversation),
        messages: messagesForConversation(conversationId)
      });
      return;
    }
    case "sendMessage": {
      const { conversationId } = routeMatch.params;
      const conversation = findConversation(conversationId);
      const body = await readJson(req);
      const content = String(body.content ?? "").trim();
      const senderId = String(body.senderId ?? "u1");

      if (!content) {
        throw new AppError("VALIDATION_ERROR", "content is required", 422, {
          field: "content"
        });
      }

      const result = await moderateText(content, {
        source: "chat",
        conversationId,
        ...config
      });

      let savedMessage = null;
      let safetyMessage = null;
      let reply = null;
      let moderationCase = null;

      if (result.decision === "block") {
        safetyMessage = systemMessage(
          conversationId,
          "安全提醒：平台不支持线下邀约、私下转账或交换私人联系方式，请在平台内完成沟通。"
        );
        moderationCase = createModerationCase({
          result,
          title: `聊天拦截：${content}`,
          source: "chat",
          content,
          targetId: conversationId,
          status: "humanReview"
        });
      } else {
        savedMessage = userMessage(conversationId, senderId, content, result);
        if (result.decision === "warn") {
          safetyMessage = systemMessage(
            conversationId,
            "安全提醒：请保持在平台内沟通，避免交换私人联系方式。"
          );
          moderationCase = createModerationCase({
            result,
            title: `聊天预警：${content}`,
            source: "chat",
            content,
            targetId: conversationId,
            status: "humanReview"
          });
        }
        if (result.decision === "review") {
          moderationCase = createModerationCase({
            result,
            title: `聊天待复核：${content}`,
            source: "chat",
            content,
            targetId: conversationId,
            status: "pending"
          });
        }
        reply = companionReply(conversation);
      }

      sendData(res, 201, requestIdValue, {
        moderation: result,
        message: savedMessage,
        safetyMessage,
        companionReply: reply,
        moderationCase,
        conversation: publicConversation(conversation)
      });
      return;
    }
    case "moderate": {
      const body = await readJson(req);
      const source = String(body.source ?? "chat");
      const conversationId = body.conversationId ? String(body.conversationId) : null;
      if (conversationId) findConversation(conversationId);
      const result = await moderateText(String(body.text ?? ""), {
        source,
        conversationId,
        ...config
      });
      sendData(res, 200, requestIdValue, {
        moderation: result
      });
      return;
    }
    case "listModerationCases": {
      sendData(res, 200, requestIdValue, {
        cases: state.moderationCases
      });
      return;
    }
    case "caseAction": {
      const body = await readJson(req);
      const action = String(body.action ?? "");
      const note = String(body.note ?? "").trim();
      sendData(res, 200, requestIdValue, applyAdminAction(routeMatch.params.caseId, action, note));
      return;
    }
    case "listViolationExamples": {
      sendData(res, 200, requestIdValue, {
        examples: violationExamples
      });
      return;
    }
    case "createLabel": {
      const body = await readJson(req);
      const text = String(body.text ?? "").trim();
      const expectedDecision = String(body.expectedDecision ?? "");
      const actualDecision = String(body.actualDecision ?? "");
      const note = String(body.note ?? "").trim();

      if (!text) {
        throw new AppError("VALIDATION_ERROR", "text is required", 422, {
          field: "text"
        });
      }
      if (!VALID_DECISIONS.has(expectedDecision) || !VALID_DECISIONS.has(actualDecision)) {
        throw new AppError("VALIDATION_ERROR", "expectedDecision and actualDecision must be valid decisions", 422, {
          allowed: [...VALID_DECISIONS]
        });
      }

      const label = {
        id: `label-${crypto.randomUUID()}`,
        text,
        expectedDecision,
        actualDecision,
        note,
        createdAt: nowIso()
      };
      state.labels.unshift(label);
      sendData(res, 201, requestIdValue, {
        label,
        count: state.labels.length
      });
      return;
    }
    case "exportLabels": {
      sendData(res, 200, requestIdValue, {
        schemaVersion: 1,
        exportedAt: nowIso(),
        count: state.labels.length,
        samples: state.labels
      });
      return;
    }
    case "reset": {
      resetState();
      sendData(res, 200, requestIdValue, {
        ok: true,
        conversations: state.conversations.length,
        messages: state.messages.length,
        moderationCases: state.moderationCases.length,
        labels: state.labels.length
      });
      return;
    }
    default:
      throw new AppError("NOT_FOUND", "Route not found", 404);
  }
}

function createServer(options = {}) {
  const config = {
    ollamaUrl: options.ollamaUrl ?? process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
    model: options.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
    disableOllama: options.disableOllama ?? process.env.DISABLE_OLLAMA === "1"
  };

  if (options.reset !== false) {
    resetState();
  }

  return createHttpServer(async (req, res) => {
    const requestIdValue = requestId();
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type"
        });
        res.end();
        return;
      }

      const routeMatch = route(req.method ?? "GET", url.pathname);
      if (routeMatch) {
        await handleApi({ req, res, routeMatch, requestIdValue, config });
        return;
      }

      await serveStatic(req, res, url.pathname);
    } catch (error) {
      sendError(res, requestIdValue, error);
    }
  });
}

async function main() {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const server = createServer();

  server.listen(port, () => {
    const model = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
    console.log(`Talk&Talk BackendDemo listening on http://localhost:${port}`);
    console.log(`Ollama model: ${model}. If health shows unavailable, run: ollama serve`);
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await main();
}

export {
  AppError,
  createServer,
  decisionForScore,
  moderateText,
  resetState,
  ruleBasedModeration
};
