import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../src/server.js";

async function withServer(fn) {
  const server = createServer({
    disableDeepSeek: true
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });
  const body = await response.json();
  assert.ok(body.meta?.requestId);
  assert.ok(body.meta?.timestamp);
  if (!response.ok) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  }
  return body.data;
}

test("health reports rule fallback when DeepSeek is disabled", async () => {
  await withServer(async (baseUrl) => {
    const data = await request(baseUrl, "/api/health");

    assert.equal(data.status, "ok");
    assert.equal(data.moderation.provider, "deepseek");
    assert.equal(data.moderation.connected, false);
    assert.equal(data.moderation.reason, "disabled");
    assert.equal(data.moderation.model, "deepseek-chat");
  });
});

test("lists conversations with message summaries", async () => {
  await withServer(async (baseUrl) => {
    const data = await request(baseUrl, "/api/conversations");

    assert.ok(data.conversations.length >= 3);
    assert.equal(data.conversations[0].id, "c1");
    assert.ok(data.conversations[0].lastMessage);
    assert.ok(data.conversations[0].messageCount > 0);
  });
});

test("returns admin overview and violation examples", async () => {
  await withServer(async (baseUrl) => {
    const overview = await request(baseUrl, "/api/admin/overview");
    const examples = await request(baseUrl, "/api/violation-examples");

    assert.ok(overview.overview.pendingCases >= 1);
    assert.ok(overview.overview.blocked >= 1);
    assert.ok(overview.queue.length >= 1);
    assert.ok(examples.examples.length >= 6);
    assert.ok(examples.examples.some((item) => item.expectedDecision === "block"));
    assert.ok(examples.examples.some((item) => item.expectedDecision === "allow"));
  });
});

test("sends a normal chat message and appends a companion reply", async () => {
  await withServer(async (baseUrl) => {
    const before = await request(baseUrl, "/api/conversations/c1/messages");

    const sent = await request(baseUrl, "/api/conversations/c1/messages", {
      method: "POST",
      body: JSON.stringify({
        content: "今天有点累，想有人认真听我说完。"
      })
    });

    assert.equal(sent.moderation.decision, "allow");
    assert.equal(sent.moderation.usedAI, false);
    assert.ok(sent.message);
    assert.ok(sent.companionReply);
    assert.equal(sent.moderationCase, null);

    const after = await request(baseUrl, "/api/conversations/c1/messages");
    assert.equal(after.messages.length, before.messages.length + 2);
    assert.ok(after.messages.some((message) => message.content === "今天有点累，想有人认真听我说完。"));
  });
});

test("blocks high-risk contact, offline, and transfer messages", async () => {
  await withServer(async (baseUrl) => {
    const riskyTexts = [
      "我们加微信聊吧",
      "今晚线下见个面",
      "我给你私下转账",
      "Jia ge Wei?",
      "加个微"
    ];

    for (const content of riskyTexts) {
      const sent = await request(baseUrl, "/api/conversations/c1/messages", {
        method: "POST",
        body: JSON.stringify({ content })
      });

      assert.equal(sent.moderation.decision, "block");
      assert.equal(sent.message, null);
      assert.ok(sent.safetyMessage);
      assert.equal(sent.moderationCase.decision, "block");
      assert.equal(sent.moderationCase.status, "humanReview");
    }

    const messages = await request(baseUrl, "/api/conversations/c1/messages");
    for (const content of riskyTexts) {
      assert.equal(messages.messages.some((message) => message.content === content), false);
    }

    const cases = await request(baseUrl, "/api/moderation-cases");
    assert.ok(cases.cases.filter((item) => item.decision === "block").length >= riskyTexts.length);
  });
});

test("moderates standalone text without writing chat history", async () => {
  await withServer(async (baseUrl) => {
    const before = await request(baseUrl, "/api/conversations/c1/messages");
    const data = await request(baseUrl, "/api/moderate", {
      method: "POST",
      body: JSON.stringify({
        text: "你在哪，告诉我真实姓名",
        source: "chat",
        conversationId: "c1"
      })
    });
    const after = await request(baseUrl, "/api/conversations/c1/messages");

    assert.equal(data.moderation.decision, "warn");
    assert.ok(data.moderation.matchedRules.includes("privacy.request"));
    assert.equal(after.messages.length, before.messages.length);
  });
});

test("stores labels and exports training samples", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "/api/labels", {
      method: "POST",
      body: JSON.stringify({
        text: "代理兼职赚钱，加我了解",
        expectedDecision: "review",
        actualDecision: "review",
        note: "广告引流边界样本"
      })
    });

    assert.equal(created.count, 1);
    assert.equal(created.label.expectedDecision, "review");

    const exported = await request(baseUrl, "/api/labels/export");
    assert.equal(exported.schemaVersion, 1);
    assert.equal(exported.count, 1);
    assert.equal(exported.samples[0].text, "代理兼职赚钱，加我了解");
  });
});

test("admin can resolve and dismiss moderation cases", async () => {
  await withServer(async (baseUrl) => {
    const cases = await request(baseUrl, "/api/moderation-cases");
    const target = cases.cases.find((item) => item.status !== "resolved" && item.status !== "dismissed");
    assert.ok(target);

    const resolved = await request(baseUrl, `/api/moderation-cases/${target.id}/actions`, {
      method: "POST",
      body: JSON.stringify({
        action: "confirmViolation",
        note: "确认线下邀约违规"
      })
    });

    assert.equal(resolved.case.status, "resolved");
    assert.ok(resolved.case.resolvedAt);
    assert.equal(resolved.case.actionLog[0].action, "confirmViolation");
    assert.ok(resolved.overview.resolved >= 1);

    const profile = cases.cases.find((item) => item.id !== target.id);
    const dismissed = await request(baseUrl, `/api/moderation-cases/${profile.id}/actions`, {
      method: "POST",
      body: JSON.stringify({
        action: "dismiss",
        note: "演示误报驳回"
      })
    });

    assert.equal(dismissed.case.status, "dismissed");
    assert.equal(dismissed.case.actionLog[0].action, "dismiss");
  });
});

test("reset restores initial in-memory state", async () => {
  await withServer(async (baseUrl) => {
    await request(baseUrl, "/api/labels", {
      method: "POST",
      body: JSON.stringify({
        text: "我们加微信聊吧",
        expectedDecision: "block",
        actualDecision: "block",
        note: "私联"
      })
    });

    const reset = await request(baseUrl, "/api/reset", {
      method: "POST",
      body: "{}"
    });
    const exported = await request(baseUrl, "/api/labels/export");

    assert.equal(reset.ok, true);
    assert.equal(reset.labels, 0);
    assert.equal(exported.count, 0);
  });
});

const deepseekKey = process.env.DEEPSEEK_API_KEY;
const deepseekTest = deepseekKey ? test : test.skip;

deepseekTest("DeepSeek moderation connects when API key is configured", async () => {
  const server = createServer({
    deepseekApiKey: deepseekKey,
    disableDeepSeek: false
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await request(baseUrl, "/api/health");
    assert.equal(health.moderation.connected, true);

    const data = await request(baseUrl, "/api/moderate", {
      method: "POST",
      body: JSON.stringify({
        text: "代理兼职赚钱，加我了解详情",
        source: "community"
      })
    });

    assert.ok(data.moderation);
    assert.equal(data.moderation.usedAI, true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
