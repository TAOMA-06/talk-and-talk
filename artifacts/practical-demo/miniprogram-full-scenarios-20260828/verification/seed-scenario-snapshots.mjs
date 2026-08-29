import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(artifactRoot, "../../..");
const { PrismaPg } = require(`${repoRoot}/backend/api/node_modules/@prisma/adapter-pg`);
const { PrismaClient } = require(`${repoRoot}/backend/api/dist/generated/prisma/client.js`);

const allowedDatabases = new Set([
  "talk_and_talk_miniprogram_full_20260828_ea11230f_01",
  "talk_and_talk_miniprogram_full_20260828_ui2_01"
]);
const databaseUrl = process.env.DATABASE_URL?.trim();
const runtimeRoot = process.env.DEMO_RUNTIME_ROOT?.trim();
if (!databaseUrl || !runtimeRoot || process.env.DEMO_FIXTURE_AUTHORIZED !== "1") {
  throw new Error("DATABASE_URL, DEMO_RUNTIME_ROOT and DEMO_FIXTURE_AUTHORIZED=1 are required");
}
const parsed = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) || !allowedDatabases.has(databaseName)) {
  throw new Error(`Refusing scenario fixture target: ${parsed.hostname}/${databaseName}`);
}
if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
  throw new Error("Scenario fixtures are disabled in production mode");
}

async function session(profile) {
  return JSON.parse(await readFile(`${runtimeRoot}/${profile}/customer-session.json`, "utf8"));
}

const [u0, u1, p1, r1] = await Promise.all([
  JSON.parse(await readFile(`${runtimeRoot}/customer-session.json`, "utf8")),
  session("u1"),
  session("p1"),
  session("r1")
]);
if (u0.user.role !== "user" || u1.user.role !== "user" || r1.user.role !== "user") {
  throw new Error("U0, U1 and R1 must be customer identities");
}
if (p1.user.id !== "seed-owner-c1" || p1.user.role !== "companion") {
  throw new Error("P1 must be the seeded c1 companion owner");
}

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
const now = new Date();
const at = (offsetMs) => new Date(now.getTime() + offsetMs);

const ids = {
  conversation: "demo-20260828-u1-c1-conversation",
  orderPending: "demo-20260828-u1-order-pending",
  orderPaid: "demo-20260828-u1-order-paid",
  orderRefunded: "demo-20260828-u1-order-refunded",
  paymentPaid: "demo-20260828-u1-payment-paid",
  paymentRefunded: "demo-20260828-u1-payment-refunded",
  refundSuccess: "demo-20260828-u1-refund-success",
  message: "demo-20260828-u1-conversation-message",
  support: "demo-20260828-u1-support-resolved",
  restriction: "demo-20260828-r1-restriction"
};

let result;
try {
  result = await prisma.$transaction(async (tx) => {
    const companion = await tx.companionProfile.findUniqueOrThrow({ where: { id: "c1" } });
    if (companion.ownerUserId !== p1.user.id) throw new Error("Seed companion ownership changed");
    const offering = await tx.companionServiceOffering.findUniqueOrThrow({
      where: { companionId_code: { companionId: "c1", code: "legacy-standard" } }
    });
    const conversation = await tx.conversation.upsert({
      where: { userId_companionId: { userId: u1.user.id, companionId: "c1" } },
      create: { id: ids.conversation, externalId: "c1", userId: u1.user.id, companionId: "c1" },
      update: { externalId: "c1" }
    });

    const orderBase = {
      userId: u1.user.id,
      companionId: "c1",
      serviceOfferingId: offering.id,
      serviceOfferingCodeSnapshot: offering.code,
      serviceOfferingTitleSnapshot: offering.title,
      serviceOfferingDeliveryModeSnapshot: offering.deliveryMode,
      serviceOfferingDurationSnapshot: offering.durationMinutes,
      serviceOfferingPriceCentsSnapshot: offering.priceCents,
      serviceOfferingCurrencySnapshot: offering.currency,
      themeId: "emotional-support",
      durationMinutes: 30,
      amountCents: offering.priceCents,
      currency: "CNY",
      companionNameSnapshot: companion.name,
      companionRoleSnapshot: companion.role,
      companionInitialsSnapshot: companion.initials,
      themeNameSnapshot: "情绪倾听",
      platformFeeBps: 2000,
      platformFeeCents: Math.round(offering.priceCents * 0.2),
      companionPayableCents: offering.priceCents - Math.round(offering.priceCents * 0.2),
      refundPolicyVersionSnapshot: "demo-20260828-v1",
      refundRequestWindowHoursSnapshot: 72,
      fulfillmentPolicyVersionSnapshot: "demo-text-v1",
      fulfillmentTimezoneSnapshot: "Asia/Shanghai"
    };

    const pending = await tx.order.upsert({
      where: { id: ids.orderPending },
      create: {
        id: ids.orderPending,
        ...orderBase,
        status: "pending",
        scheduledAt: at(24 * 60 * 60_000),
        clientRequestId: "demo-20260828-u1-pending",
        companionResponseDeadlineAt: at(2 * 60 * 60_000)
      },
      update: {
        status: "pending",
        scheduledAt: at(24 * 60 * 60_000),
        companionConfirmedAt: null,
        paidAt: null,
        cancelledAt: null,
        completedAt: null,
        conversationId: null
      }
    });
    const paid = await tx.order.upsert({
      where: { id: ids.orderPaid },
      create: {
        id: ids.orderPaid,
        ...orderBase,
        status: "paid",
        scheduledAt: at(60 * 60_000),
        clientRequestId: "demo-20260828-u1-paid",
        companionConfirmedAt: at(-90 * 60_000),
        paidAt: at(-60 * 60_000),
        customerServiceGuidelinesConfirmedAt: at(-55 * 60_000),
        companionServiceGuidelinesConfirmedAt: at(-50 * 60_000),
        conversationId: conversation.id
      },
      update: {
        status: "paid",
        scheduledAt: at(60 * 60_000),
        companionConfirmedAt: at(-90 * 60_000),
        paidAt: at(-60 * 60_000),
        conversationId: conversation.id
      }
    });
    const refunded = await tx.order.upsert({
      where: { id: ids.orderRefunded },
      create: {
        id: ids.orderRefunded,
        ...orderBase,
        status: "refunded",
        scheduledAt: at(-48 * 60 * 60_000),
        clientRequestId: "demo-20260828-u1-refunded",
        companionConfirmedAt: at(-72 * 60 * 60_000),
        paidAt: at(-71 * 60 * 60_000),
        conversationId: conversation.id
      },
      update: {
        status: "refunded",
        scheduledAt: at(-48 * 60 * 60_000),
        companionConfirmedAt: at(-72 * 60 * 60_000),
        paidAt: at(-71 * 60 * 60_000),
        conversationId: conversation.id
      }
    });

    const paidPayment = await tx.paymentTransaction.upsert({
      where: { id: ids.paymentPaid },
      create: {
        id: ids.paymentPaid,
        orderId: paid.id,
        outTradeNo: "DEMO20260828U1PAID",
        amountCents: paid.amountCents,
        status: "success",
        transactionId: "wx-demo-20260828-u1-paid",
        paidAt: at(-60 * 60_000),
        providerPaidAt: at(-60 * 60_000)
      },
      update: { status: "success", paidAt: at(-60 * 60_000), providerPaidAt: at(-60 * 60_000) }
    });
    const refundedPayment = await tx.paymentTransaction.upsert({
      where: { id: ids.paymentRefunded },
      create: {
        id: ids.paymentRefunded,
        orderId: refunded.id,
        outTradeNo: "DEMO20260828U1REFUNDED",
        amountCents: refunded.amountCents,
        status: "success",
        transactionId: "wx-demo-20260828-u1-refunded",
        paidAt: at(-71 * 60 * 60_000),
        providerPaidAt: at(-71 * 60 * 60_000)
      },
      update: { status: "success", paidAt: at(-71 * 60 * 60_000), providerPaidAt: at(-71 * 60 * 60_000) }
    });
    const refund = await tx.refundTransaction.upsert({
      where: { id: ids.refundSuccess },
      create: {
        id: ids.refundSuccess,
        orderId: refunded.id,
        paymentId: refundedPayment.id,
        outRefundNo: "DEMO20260828U1REFUNDSUCCESS",
        amountCents: refunded.amountCents,
        status: "success",
        reason: "演示退款已完成",
        providerRefundId: "wx-refund-demo-20260828-u1",
        providerRefundAcceptedAt: at(-46 * 60 * 60_000),
        providerRefundSucceededAt: at(-45 * 60 * 60_000),
        initiatedById: u1.user.id,
        resolutionDueAt: at(24 * 60 * 60_000)
      },
      update: {
        status: "success",
        providerRefundAcceptedAt: at(-46 * 60 * 60_000),
        providerRefundSucceededAt: at(-45 * 60 * 60_000),
        failureReason: null
      }
    });

    await tx.message.upsert({
      where: { id: ids.message },
      create: {
        id: ids.message,
        conversationId: conversation.id,
        senderId: p1.user.id,
        senderName: companion.name,
        content: "你的演示订单已确认，可在订单页查看当前状态。",
        type: "system",
        moderationStatus: "published",
        visibility: "participants",
        moderationDecision: "allow",
        policyVersion: "demo-fixture-v1"
      },
      update: { content: "你的演示订单已确认，可在订单页查看当前状态。" }
    });

    const support = await tx.supportTicket.upsert({
      where: { id: ids.support },
      create: {
        id: ids.support,
        userId: u1.user.id,
        orderId: paid.id,
        category: "orderIssue",
        priority: "high",
        status: "open",
        subject: "历史订单处理记录",
        body: "演示订单的处理状态需要核对。",
        assignedToUserId: null,
        dueAt: at(24 * 60 * 60_000),
        resolution: null,
        resolutionCode: null,
        resolvedAt: null
      },
      update: {
        status: "open",
        assignedToUserId: null,
        dueAt: at(24 * 60 * 60_000),
        resolution: null,
        resolutionCode: null,
        resolvedAt: null
      }
    });

    for (const notification of [
      {
        eventKey: "demo:20260828:u1:paid",
        type: "paymentSuccess",
        title: "演示订单支付成功",
        body: "订单已进入待服务状态。",
        data: { orderId: paid.id, status: "paid" }
      },
      {
        eventKey: "demo:20260828:u1:refunded",
        type: "orderStatus",
        title: "演示订单退款完成",
        body: "退款结果已更新，可在订单详情查看。",
        data: { orderId: refunded.id, status: "refunded" }
      },
      {
        eventKey: "demo:20260828:u1:support",
        type: "supportUpdate",
        title: "演示客服工单待处理",
        body: "客服工单已进入待受理队列。",
        data: { ticketId: support.id, orderId: paid.id, status: "open" }
      }
    ]) {
      await tx.notification.upsert({
        where: { eventKey: notification.eventKey },
        create: { userId: u1.user.id, ...notification },
        update: { title: notification.title, body: notification.body, data: notification.data, readAt: null }
      });
    }

    await tx.user.update({ where: { id: r1.user.id }, data: { accountStatus: "restricted" } });
    const restriction = await tx.userAccountAction.upsert({
      where: { id: ids.restriction },
      create: {
        id: ids.restriction,
        userId: r1.user.id,
        kind: "restriction",
        reasonCode: "demo-visible-restriction",
        message: "该演示账号处于受限模式，仅可读取现有记录与账号权利入口。",
        policyVersion: "demo-20260828-v1",
        sourceType: null,
        sourceReference: null,
        startsAt: at(-60 * 60_000),
        endsAt: at(48 * 60 * 60_000),
        appealDeadlineAt: at(7 * 24 * 60 * 60_000),
        createdById: null
      },
      update: {
        revokedAt: null,
        endsAt: at(48 * 60 * 60_000),
        appealDeadlineAt: at(7 * 24 * 60 * 60_000),
        message: "该演示账号处于受限模式，仅可读取现有记录与账号权利入口。"
      }
    });

    return {
      companion: { id: companion.id, ownerUserId: companion.ownerUserId },
      conversationId: conversation.id,
      orders: { pending: pending.id, paid: paid.id, refunded: refunded.id },
      payments: { paid: paidPayment.id, refunded: refundedPayment.id },
      refundId: refund.id,
      supportTicketId: support.id,
      restrictionId: restriction.id
    };
  });
} finally {
  await prisma.$disconnect();
}

const manifest = {
  generatedAt: new Date().toISOString(),
  target: { database: databaseName, loopback: true },
  mapping: {
    U0: "fresh normal customer with empty order, conversation, support and notification states",
    U1: "normal customer with order_pending, order_paid, order_refunded, conversation, successful refund, resolved support and notification fixtures",
    P1: "seeded seed-owner-c1 companion identity with c1 workbench and U1 service orders",
    R1: "restricted customer with a visible active restriction and read-only/minimal account-rights behavior"
  },
  profiles: {
    U0: { userId: u0.user.id, runtimePayload: "runtime/devtools-storage-payload.json" },
    U1: { userId: u1.user.id, runtimePayload: "runtime/u1/devtools-storage-payload.json" },
    P1: { userId: p1.user.id, companionId: "c1", runtimePayload: "runtime/p1/devtools-storage-payload.json" },
    R1: { userId: r1.user.id, accountStatus: "restricted", runtimePayload: "runtime/r1/devtools-storage-payload.json" }
  },
  records: result,
  safetyBoundaries: {
    providerCallsMade: false,
    realPaymentClaimed: false,
    bannedProfilePrepared: false,
    bannedProfileReason: "Banned JWT requests are rejected by the current guard; restricted is the safe recordable R1 minimal-rights snapshot.",
    productSourceModified: false,
    idempotentIds: true
  }
};
const defaultManifestOutput = resolve(artifactRoot, "verification/snapshot-fixture-manifest.json");
const requestedManifestOutput = process.env.DEMO_FIXTURE_MANIFEST_OUTPUT?.trim();
const manifestOutput = requestedManifestOutput ? resolve(requestedManifestOutput) : defaultManifestOutput;
if (requestedManifestOutput) {
  const ui2EvidenceRoot = resolve(repoRoot, "artifacts/ui2-visual-evidence");
  const relativeOutput = relative(ui2EvidenceRoot, manifestOutput);
  if (!relativeOutput || relativeOutput.startsWith("..") || isAbsolute(relativeOutput)) {
    throw new Error("DEMO_FIXTURE_MANIFEST_OUTPUT must be a file inside artifacts/ui2-visual-evidence");
  }
}
await writeFile(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(JSON.stringify({ database: databaseName, profiles: Object.keys(manifest.profiles), orders: result.orders }) + "\n");
