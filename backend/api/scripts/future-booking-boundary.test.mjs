import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import yaml from "js-yaml";

const files = await Promise.all([
  readFile("prisma/migrations/20260801007800_companion_customer_future_boundaries/migration.sql", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
  readFile("src/conversations/conversations.service.ts", "utf8"),
  readFile("src/orders/orders.service.ts", "utf8"),
  readFile("src/recommendations/recommendations.service.ts", "utf8"),
  readFile("../../shared/contracts/openapi/v1.yaml", "utf8"),
  readFile("../../frontend/miniprogram/pages/chat/index.wxml", "utf8"),
  readFile("../../frontend/miniprogram/pages/chat/index.ts", "utf8")
]);

const [migration, schema, conversations, orders, recommendations, openapiSource, chatWxml, chatTs] = files;

test("future-booking boundary stores only the active companion/customer pair", () => {
  const model = schema.match(/model CompanionCustomerFutureBoundary \{[\s\S]*?\n\}/)?.[0] ?? "";
  const table = migration.match(/CREATE TABLE "CompanionCustomerFutureBoundary" \([\s\S]*?\n\);/)?.[0] ?? "";
  assert.ok(model);
  assert.ok(table);
  for (const forbidden of ["reason", "status", "conversationId", "orderId", "createdById"]) {
    assert.doesNotMatch(model, new RegExp(`\\b${forbidden}\\b`, "i"));
    assert.doesNotMatch(table, new RegExp(`"${forbidden}"`, "i"));
  }
  assert.match(migration, /companionId_customerUserId_key/);
  assert.match(migration, /REFERENCES "CompanionProfile"\("id"\)[\s\S]*ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES "User"\("id"\)[\s\S]*ON DELETE CASCADE/);
});

test("mutation, order and recommendation paths close the privacy and race boundaries", () => {
  const companionLock = conversations.indexOf('SELECT "id" FROM "CompanionProfile"');
  const customerLock = conversations.indexOf('SELECT "id" FROM "User"');
  assert.ok(companionLock >= 0 && customerLock > companionLock);
  assert.match(conversations, /FUTURE_BOOKING_BOUNDARY_COMPANION_ONLY/);
  assert.match(conversations, /recommendationRequest\.updateMany/);
  assert.match(conversations, /conversation\.future_booking_declined/);
  assert.match(conversations, /conversation\.future_booking_restored/);
  assert.doesNotMatch(conversations, /future_booking_[\s\S]{0,120}(reason|notify)/i);

  assert.match(orders, /companionCustomerFutureBoundary\.findUnique/);
  assert.match(orders, /ORDER_COMPANION_UNAVAILABLE/);
  assert.doesNotMatch(orders, /ORDER_COMPANION_UNAVAILABLE[\s\S]{0,240}(boundaryId|reasonCode)/);

  assert.ok((recommendations.match(/privateUnavailableCompanionIds\(/g) ?? []).length >= 4);
  assert.match(recommendations, /SELECT "id" FROM "User"[\s\S]*FOR UPDATE/);
  assert.match(recommendations, /companionCustomerFutureBoundary\.findMany/);
});

test("public contract and mini program expose only the companion-owned future-only control", () => {
  const document = yaml.load(openapiSource);
  const operation = document.paths["/conversations/{id}/future-booking-boundary"].put;
  const output = operation.responses["200"].content["application/json"].schema
    .allOf[1].properties.data.properties;
  assert.deepEqual(Object.keys(operation.requestBody.content["application/json"].schema.properties), ["declined"]);
  for (const forbidden of ["reason", "reasonCode", "customerUserId", "boundaryId"]) {
    assert.equal(output[forbidden], undefined);
  }
  assert.match(chatWxml, /viewerCanManageFutureBookingBoundary/);
  assert.match(chatWxml, /客户不会收到原因或被处罚/);
  assert.match(chatWxml, /现有订单与聊天不变/);
  assert.match(chatTs, /现有订单、聊天、退款、评价、举报与客服处理均不受影响/);
});
