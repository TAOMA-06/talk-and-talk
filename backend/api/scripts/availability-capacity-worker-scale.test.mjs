import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import pg from "pg";
import { assertIsolatedPostgresPreflightEnvironment, POSTGRES_PREFLIGHT_SUITE } from "./isolated-postgres-preflight-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migration04000 = join(
  apiRoot,
  "prisma/migrations/20260801004000_order_scheduling_overlap_indexes/migration.sql"
);
const migration06000 = join(
  apiRoot,
  "prisma/migrations/20260801006000_availability_reminder_worker_claims/migration.sql"
);
const migration06100 = join(
  apiRoot,
  "prisma/migrations/20260801006100_availability_reminder_terminal_resolution/migration.sql"
);

test("capacity and reminder workers retain bounded PostgreSQL boundaries", async () => {
  const [
    capacity,
    preparation,
    reservation,
    delivery,
    deliveryBoundary,
    moduleSource,
    migration,
    terminalMigration
  ] = await Promise.all([
    readFile(join(apiRoot, "src/companions/companion-capacity-query.ts"), "utf8"),
    readFile(join(apiRoot, "src/favorites/availability-reminder-preparation.service.ts"), "utf8"),
    readFile(join(apiRoot, "src/favorites/availability-reminder-reservation.service.ts"), "utf8"),
    readFile(join(apiRoot, "src/favorites/availability-reminder-delivery.runner.ts"), "utf8"),
    readFile(join(apiRoot, "src/favorites/availability-reminder-attempt-delivery.service.ts"), "utf8"),
    readFile(join(apiRoot, "src/favorites/favorites.module.ts"), "utf8"),
    readFile(migration06000, "utf8"),
    readFile(migration06100, "utf8")
  ]);
  assert.match(capacity, /reservation\."scheduledAt"\s*\+ make_interval/);
  assert.match(capacity, /LIMIT availability_window\."capacity"/);
  assert.match(capacity, /ANY\(\$\{input\.companionIds\}::text\[\]\)/);
  for (const source of [preparation, reservation, delivery]) {
    assert.match(source, /FOR UPDATE SKIP LOCKED/);
    assert.match(source, /NextAttemptAt/);
    assert.match(source, /FailedAt/);
  }
  assert.match(migration, /AvailabilityReminderCandidate_preparation_due/);
  assert.match(migration, /AvailabilityReminderHandoff_worker_due/);
  assert.match(migration, /AvailabilityReminderAttempt_delivery_due/);
  assert.match(migration, /preparation_lease_complete/);
  assert.match(migration, /reservation_lease_complete/);
  assert.match(migration, /delivery_claim_complete/);
  assert.match(migration, /failure_nonnegative/g);
  assert.match(migration, /terminal_has_error/g);
  assert.match(migration, /preparation_token/);
  assert.match(migration, /reservation_token/);
  assert.match(migration, /delivery_token/);
  assert.match(deliveryBoundary, /data:\s*\{ companionId: claim\.companionId \}/);
  assert.doesNotMatch(moduleSource, /AvailabilityReminderReadinessService/);
  assert.match(terminalMigration, /AvailabilityReminderAttempt_terminal_fact_immutable/);
  assert.match(terminalMigration, /OLD\."status"::text IN \('sent', 'skipped', 'failedBeforeSend', 'rejected', 'uncertain'\)/);
  assert.match(terminalMigration, /operational resolution is immutable/);
});

const integrationUrl = String(process.env.AVAILABILITY_CAPACITY_TEST_DATABASE_URL ?? "").trim();
const postgresPreflight = process.env.E2E_RUNNER_SUITE === POSTGRES_PREFLIGHT_SUITE
  ? assertIsolatedPostgresPreflightEnvironment()
  : null;

if (postgresPreflight) test("real PostgreSQL capacity SQL and ten replicas stay bounded and nonoverlapping", async (t) => {
  await postgresPreflight;
  const schema = `availability_scale_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const replicas = Array.from({ length: 10 }, () => new pg.Client({ connectionString: integrationUrl }));
  await Promise.all([admin.connect(), ...replicas.map((client) => client.connect())]);
  t.after(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([admin.end(), ...replicas.map((client) => client.end())]);
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const client of [admin, ...replicas]) await client.query(`SET search_path TO "${schema}"`);

  await admin.query(`
    CREATE TABLE "User" ("id" text PRIMARY KEY);
    CREATE TABLE "CompanionServiceOffering" (
      "id" text PRIMARY KEY, "companionId" text NOT NULL, "durationMinutes" integer NOT NULL,
      "priceCents" integer NOT NULL, "currency" text NOT NULL,
      "deliveryMode" text NOT NULL, "topicIds" text[] NOT NULL DEFAULT '{}', "isActive" boolean NOT NULL
    );
    CREATE TABLE "CompanionAvailabilityWindow" (
      "id" text PRIMARY KEY, "companionId" text NOT NULL, "startsAt" timestamp(3) NOT NULL,
      "endsAt" timestamp(3) NOT NULL, "capacity" integer NOT NULL, "isActive" boolean NOT NULL
    );
    CREATE TABLE "Order" (
      "id" text PRIMARY KEY, "companionId" text NOT NULL, "status" text NOT NULL,
      "scheduledAt" timestamp(3) NOT NULL, "durationMinutes" integer NOT NULL,
      "companionConfirmedAt" timestamp(3), "paymentReservationExpiresAt" timestamp(3)
    );
    CREATE TABLE "AvailabilityReminderCandidate" (
      "id" text PRIMARY KEY, "preflightDecision" text NOT NULL DEFAULT 'pending',
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "AvailabilityReminderHandoff" (
      "id" text PRIMARY KEY, "candidateId" text UNIQUE NOT NULL,
      "reservationProcessedAt" timestamp(3), "reservationOutcomeReason" text,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "AvailabilityReminderAttempt" (
      "id" text PRIMARY KEY, "handoffId" text UNIQUE NOT NULL, "subscriptionGrantId" text UNIQUE NOT NULL,
      "status" text NOT NULL DEFAULT 'reserved', "outcomeReason" text,
      "authorizationConsumedAt" timestamp(3), "sendLeaseToken" text UNIQUE,
      "sendLeaseExpiresAt" timestamp(3), "providerAttemptStartedAt" timestamp(3),
      "providerResolvedAt" timestamp(3), "providerMessageId" text, "providerErrorCode" text,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await admin.query(await readFile(migration04000, "utf8"));
  await admin.query(await readFile(migration06000, "utf8"));
  await admin.query(await readFile(migration06100, "utf8"));
  await admin.query(`INSERT INTO "User" ("id") VALUES ('operator-1')`);

  const evaluatedAt = new Date("2030-01-01T08:00:00.000Z");
  const earliestStart = new Date("2030-01-01T10:00:00.000Z");
  const until = new Date("2030-01-01T12:00:00.000Z");
  await admin.query(`
    INSERT INTO "CompanionServiceOffering" (
      "id", "companionId", "durationMinutes", "priceCents", "currency", "deliveryMode", "topicIds", "isActive"
    ) VALUES ('offering-1', 'companion-1', 30, 3900, 'CNY', 'text', ARRAY['topic-1'], TRUE);
    INSERT INTO "CompanionAvailabilityWindow" (
      "id", "companionId", "startsAt", "endsAt", "capacity", "isActive"
    ) VALUES ('window-1', 'companion-1', '2030-01-01T10:00:00Z', '2030-01-01T12:00:00Z', 1, TRUE);
    INSERT INTO "Order" (
      "id", "companionId", "status", "scheduledAt", "durationMinutes", "companionConfirmedAt"
    )
    SELECT 'historic-' || lpad(series::text, 6, '0'), 'companion-1', 'paid',
           '2020-01-01T00:00:00Z'::timestamp + series * INTERVAL '1 minute', 30, NOW()
    FROM generate_series(1, 100000) series;
    INSERT INTO "Order" (
      "id", "companionId", "status", "scheduledAt", "durationMinutes", "companionConfirmedAt"
    ) VALUES
      ('legacy-long-overlap', 'companion-1', 'paid', '2030-01-01T01:00:00Z', 600, NOW()),
      ('unconfirmed-pending', 'companion-1', 'pending', '2030-01-01T11:00:00Z', 30, NULL);
    ANALYZE "Order";
  `);

  const capacityModuleUrl = pathToFileURL(join(
    apiRoot,
    "src/companions/companion-capacity-query.ts"
  )).href;
  const capacityModule = await import(capacityModuleUrl);
  let captured = null;
  const taggedDatabase = {
    async $queryRaw(strings, ...values) {
      const sql = strings.reduce(
        (text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ""),
        ""
      );
      captured = { sql, values };
      return (await admin.query(sql, values)).rows;
    }
  };
  const matches = await capacityModule.findCompanionCapacityMatches(taggedDatabase, {
    companionIds: ["companion-1"], earliestStart, until, evaluatedAt,
    topicId: "topic-1", deliveryMode: "text", maxServicePriceCents: 5000
  });
  if (matches.length === 0) {
    const slots = await capacityModule.findPublicAvailabilitySlots(taggedDatabase, {
      companionId: "companion-1", durationMinutes: 30,
      earliestStart, until, evaluatedAt, limit: 100
    });
    const diagnostics = await admin.query(`
      SELECT
        availability_window."startsAt"::text AS "windowStart",
        availability_window."endsAt"::text AS "windowEnd",
        (SELECT COUNT(*)::integer FROM "Order" reservation
         WHERE reservation."scheduledAt" < '2030-01-01 11:30:00'::timestamp
           AND (reservation."status" <> 'pending' OR (
             reservation."companionConfirmedAt" IS NOT NULL
             AND (reservation."paymentReservationExpiresAt" IS NULL
                  OR reservation."paymentReservationExpiresAt" > '2030-01-01 08:00:00'::timestamp)
           ))
           AND reservation."scheduledAt" + make_interval(mins => reservation."durationMinutes")
             > '2030-01-01 11:00:00'::timestamp) AS "overlapAtEleven",
        (SELECT MAX(reservation."scheduledAt")::text FROM "Order" reservation
         WHERE reservation."id" LIKE 'historic-%') AS "latestHistoric",
        (SELECT COUNT(*)::integer FROM generate_series(
          date_bin(INTERVAL '30 minutes', availability_window."startsAt", TIMESTAMP '2000-01-01'),
          availability_window."endsAt" - INTERVAL '30 minutes', INTERVAL '30 minutes'
        )) AS "slotCount"
      FROM "CompanionAvailabilityWindow" availability_window
      WHERE availability_window."id" = 'window-1'
    `);
    const directSlots = await admin.query(`
      SELECT slot."startsAt", (
        SELECT COUNT(*)::integer FROM (
          SELECT 1 FROM "Order" reservation
          WHERE reservation."companionId" = 'companion-1'
            AND reservation."status" IN ('pending', 'paying', 'paid', 'inService', 'completed')
            AND (reservation."status" <> 'pending' OR (
              reservation."companionConfirmedAt" IS NOT NULL
              AND (reservation."paymentReservationExpiresAt" IS NULL
                   OR reservation."paymentReservationExpiresAt" > '2030-01-01 08:00:00'::timestamp)
            ))
            AND reservation."scheduledAt" < slot."startsAt" + INTERVAL '30 minutes'
            AND reservation."scheduledAt" + make_interval(mins => reservation."durationMinutes")
              > slot."startsAt"
          LIMIT availability_window."capacity"
        ) bounded
      ) AS "reserved"
      FROM "CompanionAvailabilityWindow" availability_window
      CROSS JOIN LATERAL generate_series(
        '2030-01-01 10:00:00'::timestamp,
        availability_window."endsAt" - INTERVAL '30 minutes', INTERVAL '30 minutes'
      ) slot("startsAt")
      WHERE availability_window."id" = 'window-1'
    `);
    assert.fail(
      `catalog returned no match; direct slot count=${slots.length}; `
      + `diagnostics=${JSON.stringify(diagnostics.rows)}; direct=${JSON.stringify(directSlots.rows)}; `
      + `params=${JSON.stringify(captured?.values)}`
    );
  }
  assert.equal(matches.length, 1);
  assert.equal(matches[0].earliestStartsAt.toISOString(), "2030-01-01T11:00:00.000Z");
  assert.ok(captured);
  const plan = await admin.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured.sql}`, captured.values);
  const serializedPlan = JSON.stringify(plan.rows[0]["QUERY PLAN"]);
  assert.match(serializedPlan, /Order_companion_status_scheduled(At|End)_id/);
  const executionTime = plan.rows[0]["QUERY PLAN"][0]["Execution Time"];
  assert.ok(executionTime < 5_000, `capacity query took ${executionTime}ms`);

  await admin.query(`
    INSERT INTO "AvailabilityReminderCandidate" ("id", "createdAt")
    SELECT 'candidate-' || lpad(series::text, 5, '0'), NOW() - INTERVAL '10 minutes'
    FROM generate_series(1, 10000) series;
    UPDATE "AvailabilityReminderCandidate"
    SET "preparationFailedAt" = NOW(), "preparationLastErrorCode" = 'POISON_ROW'
    WHERE "id" = 'candidate-00001';
  `);
  const claimAt = new Date();
  const leaseExpiresAt = new Date(claimAt.getTime() + 120_000);
  const preparationClaimSql = `
    WITH due AS (
      SELECT candidate."id" FROM "AvailabilityReminderCandidate" candidate
      WHERE candidate."preflightDecision" IN ('pending', 'eligible')
        AND candidate."preparationFailedAt" IS NULL
        AND candidate."preparationNextAttemptAt" <= $1
        AND (candidate."preparationLeaseToken" IS NULL OR candidate."preparationLeaseExpiresAt" IS NULL
             OR candidate."preparationLeaseExpiresAt" <= $1)
        AND NOT EXISTS (SELECT 1 FROM "AvailabilityReminderHandoff" handoff
                        WHERE handoff."candidateId" = candidate."id")
      ORDER BY candidate."createdAt", candidate."id"
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "AvailabilityReminderCandidate" candidate
    SET "preparationLeaseToken" = $2, "preparationLeaseExpiresAt" = $3
    FROM due WHERE candidate."id" = due."id" RETURNING candidate."id"
  `;
  const claimedByReplica = await Promise.all(replicas.map(async (client, replicaIndex) => {
    const ids = [];
    for (let index = 0; ; index += 1) {
      const result = await client.query(preparationClaimSql, [
        claimAt,
        `replica-${replicaIndex}-${index}`,
        leaseExpiresAt
      ]);
      if (result.rowCount === 0) break;
      ids.push(result.rows[0].id);
      if (index % 100 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    return ids;
  }));
  const claimed = claimedByReplica.flat();
  assert.equal(claimed.length, 9_999);
  assert.equal(new Set(claimed).size, 9_999, "replicas must never claim one candidate twice");
  assert.equal(claimedByReplica.filter((ids) => ids.length > 0).length, 10);
  const poison = await admin.query(`
    SELECT "preparationLeaseToken", "preparationFailedAt" IS NOT NULL AS "failed"
    FROM "AvailabilityReminderCandidate" WHERE "id" = 'candidate-00001'
  `);
  assert.deepEqual(poison.rows[0], { preparationLeaseToken: null, failed: true });

  await admin.query(`
    INSERT INTO "AvailabilityReminderHandoff" ("id", "candidateId", "createdAt")
    SELECT 'handoff-' || lpad(series::text, 5, '0'),
           'handoff-candidate-' || lpad(series::text, 5, '0'),
           NOW() - INTERVAL '10 minutes'
    FROM generate_series(1, 2000) series;
    UPDATE "AvailabilityReminderHandoff"
    SET "reservationFailedAt" = NOW(), "reservationLastErrorCode" = 'POISON_ROW'
    WHERE "id" = 'handoff-00001';
  `);
  const reservationClaimSql = `
    WITH due AS (
      SELECT handoff."id" FROM "AvailabilityReminderHandoff" handoff
      WHERE handoff."reservationProcessedAt" IS NULL
        AND handoff."reservationFailedAt" IS NULL
        AND handoff."reservationNextAttemptAt" <= $1
        AND (handoff."reservationLeaseToken" IS NULL OR handoff."reservationLeaseExpiresAt" IS NULL
             OR handoff."reservationLeaseExpiresAt" <= $1)
      ORDER BY handoff."createdAt", handoff."id"
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "AvailabilityReminderHandoff" handoff
    SET "reservationLeaseToken" = $2, "reservationLeaseExpiresAt" = $3
    FROM due WHERE handoff."id" = due."id" RETURNING handoff."id"
  `;
  const claimAcrossReplicas = async (sql, tokenPrefix) => {
    const stageClaimAt = new Date();
    const stageLeaseExpiresAt = new Date(stageClaimAt.getTime() + 120_000);
    return Promise.all(replicas.map(async (client, replicaIndex) => {
      const ids = [];
      for (let index = 0; ; index += 1) {
        const claimedRow = await client.query(sql, [
          stageClaimAt,
          `${tokenPrefix}-${replicaIndex}-${index}`,
          stageLeaseExpiresAt
        ]);
        if (claimedRow.rowCount === 0) break;
        ids.push(claimedRow.rows[0].id);
        if (index % 25 === 0) await new Promise((resolve) => setImmediate(resolve));
      }
      return ids;
    }));
  };
  const reservationClaims = (await claimAcrossReplicas(reservationClaimSql, "reservation")).flat();
  assert.equal(reservationClaims.length, 1_999);
  assert.equal(new Set(reservationClaims).size, 1_999, "reservation handoffs must not overlap across replicas");

  await admin.query(`
    INSERT INTO "AvailabilityReminderAttempt" (
      "id", "handoffId", "subscriptionGrantId", "status", "createdAt", "updatedAt"
    )
    SELECT 'attempt-' || lpad(series::text, 5, '0'),
           'attempt-handoff-' || lpad(series::text, 5, '0'),
           'attempt-grant-' || lpad(series::text, 5, '0'),
           'reserved', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes'
    FROM generate_series(1, 2000) series;
    UPDATE "AvailabilityReminderAttempt"
    SET "deliveryFailedAt" = NOW(), "deliveryLastErrorCode" = 'POISON_ROW'
    WHERE "id" = 'attempt-00001';
  `);
  const deliveryClaimSql = `
    WITH due AS (
      SELECT attempt."id" FROM "AvailabilityReminderAttempt" attempt
      WHERE attempt."deliveryFailedAt" IS NULL
        AND attempt."deliveryNextAttemptAt" <= $1
        AND (attempt."deliveryClaimToken" IS NULL OR attempt."deliveryClaimExpiresAt" IS NULL
             OR attempt."deliveryClaimExpiresAt" <= $1)
        AND (attempt."status" = 'reserved' OR (
          attempt."status" IN ('readyToSend', 'sending')
          AND (attempt."sendLeaseExpiresAt" IS NULL OR attempt."sendLeaseExpiresAt" <= $1)
        ))
      ORDER BY CASE WHEN attempt."status" IN ('readyToSend', 'sending') THEN 0 ELSE 1 END,
               attempt."createdAt", attempt."id"
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "AvailabilityReminderAttempt" attempt
    SET "deliveryClaimToken" = $2, "deliveryClaimExpiresAt" = $3, "updatedAt" = $1
    FROM due WHERE attempt."id" = due."id" RETURNING attempt."id"
  `;
  const deliveryClaims = (await claimAcrossReplicas(deliveryClaimSql, "delivery")).flat();
  assert.equal(deliveryClaims.length, 1_999);
  assert.equal(new Set(deliveryClaims).size, 1_999, "delivery attempts must not overlap across replicas");

  await assert.rejects(
    admin.query(`INSERT INTO "AvailabilityReminderCandidate"
                 ("id", "preparationLeaseToken") VALUES ('invalid-half-lease', 'half')`),
    (error) => error?.code === "23514"
  );
  await assert.rejects(
    admin.query(`INSERT INTO "AvailabilityReminderHandoff"
                 ("id", "candidateId", "reservationFailureCount")
                 VALUES ('invalid-negative-failure', 'invalid-candidate', -1)`),
    (error) => error?.code === "23514"
  );
  await assert.rejects(
    admin.query(`INSERT INTO "AvailabilityReminderAttempt"
                 ("id", "handoffId", "subscriptionGrantId", "deliveryFailedAt")
                 VALUES ('invalid-terminal-error', 'invalid-handoff', 'invalid-grant', NOW())`),
    (error) => error?.code === "23514"
  );
  await assert.rejects(
    admin.query(`UPDATE "AvailabilityReminderCandidate"
                 SET "preparationLeaseToken" = 'duplicate-token',
                     "preparationLeaseExpiresAt" = NOW() + INTERVAL '1 minute'
                 WHERE "id" IN ('candidate-00002', 'candidate-00003')`),
    (error) => error?.code === "23505"
  );

  await admin.query(`
    UPDATE "AvailabilityReminderAttempt"
    SET "status" = 'uncertain',
        "outcomeReason" = 'providerUnknown',
        "providerAttemptStartedAt" = NOW() - INTERVAL '1 minute',
        "providerResolvedAt" = NOW(),
        "providerErrorCode" = 'DELIVERY_UNKNOWN'
    WHERE "id" = 'attempt-00002';
    UPDATE "AvailabilityReminderAttempt"
    SET "operationalResolvedAt" = NOW(),
        "operationalResolvedById" = 'operator-1',
        "operationalResolutionCode" = 'uncertainProviderStateReconciled',
        "operationalResolutionNote" = 'Provider dashboard reconciled',
        "operationalEvidenceRef" = 'ops://incident/REM-1'
    WHERE "id" = 'attempt-00002';
  `);
  await assert.rejects(
    admin.query(`UPDATE "AvailabilityReminderAttempt"
                 SET "providerErrorCode" = 'REWRITTEN'
                 WHERE "id" = 'attempt-00002'`),
    (error) => error?.code === "23514" && /terminal provider facts are immutable/.test(error.message)
  );
  await assert.rejects(
    admin.query(`UPDATE "AvailabilityReminderAttempt"
                 SET "operationalResolutionNote" = 'rewritten'
                 WHERE "id" = 'attempt-00002'`),
    (error) => error?.code === "23514" && /operational resolution is immutable/.test(error.message)
  );

  const claimPlan = await admin.query(
    `EXPLAIN (FORMAT JSON) ${preparationClaimSql}`,
    [claimAt, "plan-token", leaseExpiresAt]
  );
  assert.match(JSON.stringify(claimPlan.rows[0]["QUERY PLAN"]), /AvailabilityReminderCandidate_preparation_due/);
});
