export const BOOKABLE_ORDER_STATUSES = ["pending", "paying", "paid", "inService", "completed"] as const;

export type CapacityQueryDatabase = {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

export type CompanionCapacityFilter = {
  companionIds: string[];
  earliestStart: Date;
  until: Date;
  evaluatedAt: Date;
  topicId?: string;
  deliveryMode?: "text" | "voice";
  maxServicePriceCents?: number;
};

export type CompanionCapacityMatch = {
  id: string;
  earliestStartsAt: Date;
  startingPriceCents: number;
  startingDurationMinutes: number;
  currency: string;
  deliveryModes: Array<"text" | "voice">;
};

export type PublicAvailabilitySlot = {
  availabilityWindowId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  reservedCount: number;
};

const normalizeDate = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const normalizeNumber = (value: unknown) => Number(value);

/**
 * PostgreSQL-owned public sellability boundary. The profile ids passed here
 * are one bounded catalog page only. Each offering asks the database for its
 * first real slot; the correlated reservation aggregate stops after at most
 * `window.capacity` rows and uses true interval overlap for legacy durations.
 */
export async function findCompanionCapacityMatches(
  db: CapacityQueryDatabase,
  input: CompanionCapacityFilter
): Promise<CompanionCapacityMatch[]> {
  if (input.companionIds.length === 0) return [];
  const topicId = input.topicId ?? null;
  const deliveryMode = input.deliveryMode ?? null;
  const maxServicePriceCents = input.maxServicePriceCents ?? null;
  const rows = await db.$queryRaw`
    WITH sellable_offerings AS (
      SELECT
        offering."companionId",
        offering."id" AS "offeringId",
        offering."durationMinutes",
        offering."priceCents",
        offering."currency",
        offering."deliveryMode"::text AS "deliveryMode",
        first_slot."startsAt" AS "earliestStartsAt"
      FROM "CompanionServiceOffering" offering
      JOIN LATERAL (
        SELECT slot."startsAt"
        FROM "CompanionAvailabilityWindow" availability_window
        CROSS JOIN LATERAL (
          SELECT GREATEST(
            availability_window."startsAt",
            ${input.earliestStart}::timestamptz AT TIME ZONE 'UTC'
          ) AS "rawStart"
        ) raw_start
        CROSS JOIN LATERAL (
          SELECT date_bin(
            INTERVAL '30 minutes',
            raw_start."rawStart",
            TIMESTAMP '2000-01-01 00:00:00'
          ) AS "floorStart"
        ) floor_start
        CROSS JOIN LATERAL generate_series(
          floor_start."floorStart"
            + CASE WHEN floor_start."floorStart" < raw_start."rawStart"
                THEN INTERVAL '30 minutes' ELSE INTERVAL '0 minutes' END,
          LEAST(
            availability_window."endsAt",
            ${input.until}::timestamptz AT TIME ZONE 'UTC'
          )
            - make_interval(mins => offering."durationMinutes"),
          INTERVAL '30 minutes'
        ) AS slot("startsAt")
        WHERE availability_window."companionId" = offering."companionId"
          AND availability_window."isActive" = TRUE
          AND availability_window."startsAt" < (${input.until}::timestamptz AT TIME ZONE 'UTC')
          AND availability_window."endsAt" > (${input.earliestStart}::timestamptz AT TIME ZONE 'UTC')
          AND (
            SELECT COUNT(*)
            FROM (
              SELECT 1
              FROM "Order" reservation
              WHERE reservation."companionId" = offering."companionId"
                AND reservation."status"::text IN ('pending', 'paying', 'paid', 'inService', 'completed')
                AND reservation."durationMinutes" > 0
                AND (
                  reservation."status"::text <> 'pending'
                  OR (
                    reservation."companionConfirmedAt" IS NOT NULL
                    AND (
                      reservation."paymentReservationExpiresAt" IS NULL
                      OR reservation."paymentReservationExpiresAt"
                        > (${input.evaluatedAt}::timestamptz AT TIME ZONE 'UTC')
                    )
                  )
                )
                AND reservation."scheduledAt"
                  < slot."startsAt" + make_interval(mins => offering."durationMinutes")
                AND reservation."scheduledAt"
                    + make_interval(mins => reservation."durationMinutes")
                  > slot."startsAt"
              LIMIT availability_window."capacity"
            ) bounded_reservations
          ) < availability_window."capacity"
        ORDER BY slot."startsAt" ASC, availability_window."id" ASC
        LIMIT 1
      ) first_slot ON TRUE
      WHERE offering."companionId" = ANY(${input.companionIds}::text[])
        AND offering."isActive" = TRUE
        AND (${topicId}::text IS NULL OR ${topicId} = ANY(offering."topicIds"))
        AND (${deliveryMode}::text IS NULL OR offering."deliveryMode"::text = ${deliveryMode})
        AND (${maxServicePriceCents}::integer IS NULL OR offering."priceCents" <= ${maxServicePriceCents})
    ), starting_offerings AS (
      SELECT DISTINCT ON (sellable."companionId")
        sellable."companionId",
        sellable."priceCents",
        sellable."durationMinutes",
        sellable."currency"
      FROM sellable_offerings sellable
      ORDER BY
        sellable."companionId",
        sellable."priceCents" ASC,
        sellable."durationMinutes" ASC,
        sellable."offeringId" ASC
    )
    SELECT
      sellable."companionId" AS "id",
      MIN(sellable."earliestStartsAt") AT TIME ZONE 'UTC' AS "earliestStartsAt",
      starting."priceCents" AS "startingPriceCents",
      starting."durationMinutes" AS "startingDurationMinutes",
      starting."currency",
      ARRAY_AGG(DISTINCT sellable."deliveryMode" ORDER BY sellable."deliveryMode") AS "deliveryModes"
    FROM sellable_offerings sellable
    JOIN starting_offerings starting
      ON starting."companionId" = sellable."companionId"
    GROUP BY
      sellable."companionId",
      starting."priceCents",
      starting."durationMinutes",
      starting."currency"
    ORDER BY sellable."companionId" ASC
  ` as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    earliestStartsAt: normalizeDate(row.earliestStartsAt),
    startingPriceCents: normalizeNumber(row.startingPriceCents),
    startingDurationMinutes: normalizeNumber(row.startingDurationMinutes),
    currency: String(row.currency),
    deliveryModes: (Array.isArray(row.deliveryModes) ? row.deliveryModes : [])
      .map(String)
      .filter((mode): mode is "text" | "voice" => mode === "text" || mode === "voice")
  }));
}

/** Returns a bounded, ordered public slot page with reservation counts. */
export async function findPublicAvailabilitySlots(
  db: CapacityQueryDatabase,
  input: {
    companionId: string;
    durationMinutes: number;
    earliestStart: Date;
    until: Date;
    evaluatedAt: Date;
    limit: number;
  }
): Promise<PublicAvailabilitySlot[]> {
  const rows = await db.$queryRaw`
    SELECT
      availability_window."id" AS "availabilityWindowId",
      slot."startsAt" AT TIME ZONE 'UTC' AS "startsAt",
      (slot."startsAt" + make_interval(mins => ${input.durationMinutes}))
        AT TIME ZONE 'UTC' AS "endsAt",
      availability_window."capacity",
      reservation_count."reservedCount"
    FROM "CompanionAvailabilityWindow" availability_window
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        availability_window."startsAt",
        ${input.earliestStart}::timestamptz AT TIME ZONE 'UTC'
      ) AS "rawStart"
    ) raw_start
    CROSS JOIN LATERAL (
      SELECT date_bin(
        INTERVAL '30 minutes',
        raw_start."rawStart",
        TIMESTAMP '2000-01-01 00:00:00'
      ) AS "floorStart"
    ) floor_start
    CROSS JOIN LATERAL generate_series(
      floor_start."floorStart"
        + CASE WHEN floor_start."floorStart" < raw_start."rawStart"
            THEN INTERVAL '30 minutes' ELSE INTERVAL '0 minutes' END,
      LEAST(
        availability_window."endsAt",
        ${input.until}::timestamptz AT TIME ZONE 'UTC'
      ) - make_interval(mins => ${input.durationMinutes}),
      INTERVAL '30 minutes'
    ) AS slot("startsAt")
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::integer AS "reservedCount"
      FROM (
        SELECT 1
        FROM "Order" reservation
        WHERE reservation."companionId" = ${input.companionId}
          AND reservation."status"::text IN ('pending', 'paying', 'paid', 'inService', 'completed')
          AND reservation."durationMinutes" > 0
          AND (
            reservation."status"::text <> 'pending'
            OR (
              reservation."companionConfirmedAt" IS NOT NULL
              AND (
                reservation."paymentReservationExpiresAt" IS NULL
                OR reservation."paymentReservationExpiresAt"
                  > (${input.evaluatedAt}::timestamptz AT TIME ZONE 'UTC')
              )
            )
          )
          AND reservation."scheduledAt"
            < slot."startsAt" + make_interval(mins => ${input.durationMinutes})
          AND reservation."scheduledAt" + make_interval(mins => reservation."durationMinutes")
            > slot."startsAt"
        LIMIT availability_window."capacity"
      ) bounded_reservations
    ) reservation_count
    WHERE availability_window."companionId" = ${input.companionId}
      AND availability_window."isActive" = TRUE
      AND availability_window."startsAt" < (${input.until}::timestamptz AT TIME ZONE 'UTC')
      AND availability_window."endsAt" > (${input.earliestStart}::timestamptz AT TIME ZONE 'UTC')
      AND reservation_count."reservedCount" < availability_window."capacity"
    ORDER BY slot."startsAt" ASC, availability_window."id" ASC
    LIMIT ${input.limit}
  ` as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    availabilityWindowId: String(row.availabilityWindowId),
    startsAt: normalizeDate(row.startsAt),
    endsAt: normalizeDate(row.endsAt),
    capacity: normalizeNumber(row.capacity),
    reservedCount: normalizeNumber(row.reservedCount)
  }));
}

/** Fast single-window preflight shared by preparation and final reservation. */
export async function hasBookableCapacityInWindow(
  db: CapacityQueryDatabase,
  input: {
    companionId: string;
    availabilityWindowId: string;
    durationMinutes: number[];
    earliestStart: Date;
    until: Date;
    evaluatedAt: Date;
  }
): Promise<boolean> {
  if (input.durationMinutes.length === 0) return false;
  const rows = await db.$queryRaw`
    SELECT TRUE AS "available"
    FROM "CompanionAvailabilityWindow" availability_window
    CROSS JOIN LATERAL unnest(${input.durationMinutes}::integer[]) AS duration("minutes")
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        availability_window."startsAt",
        ${input.earliestStart}::timestamptz AT TIME ZONE 'UTC'
      ) AS "rawStart"
    ) raw_start
    CROSS JOIN LATERAL (
      SELECT date_bin(
        INTERVAL '30 minutes',
        raw_start."rawStart",
        TIMESTAMP '2000-01-01 00:00:00'
      ) AS "floorStart"
    ) floor_start
    CROSS JOIN LATERAL generate_series(
      floor_start."floorStart"
        + CASE WHEN floor_start."floorStart" < raw_start."rawStart"
            THEN INTERVAL '30 minutes' ELSE INTERVAL '0 minutes' END,
      LEAST(
        availability_window."endsAt",
        ${input.until}::timestamptz AT TIME ZONE 'UTC'
      ) - make_interval(mins => duration."minutes"),
      INTERVAL '30 minutes'
    ) AS slot("startsAt")
    WHERE availability_window."id" = ${input.availabilityWindowId}
      AND availability_window."companionId" = ${input.companionId}
      AND availability_window."isActive" = TRUE
      AND availability_window."startsAt" < (${input.until}::timestamptz AT TIME ZONE 'UTC')
      AND availability_window."endsAt" > (${input.earliestStart}::timestamptz AT TIME ZONE 'UTC')
      AND (
        SELECT COUNT(*)
        FROM (
          SELECT 1
          FROM "Order" reservation
          WHERE reservation."companionId" = ${input.companionId}
            AND reservation."status"::text IN ('pending', 'paying', 'paid', 'inService', 'completed')
            AND reservation."durationMinutes" > 0
            AND (
              reservation."status"::text <> 'pending'
              OR (
                reservation."companionConfirmedAt" IS NOT NULL
                AND (
                  reservation."paymentReservationExpiresAt" IS NULL
                  OR reservation."paymentReservationExpiresAt"
                    > (${input.evaluatedAt}::timestamptz AT TIME ZONE 'UTC')
                )
              )
            )
            AND reservation."scheduledAt"
              < slot."startsAt" + make_interval(mins => duration."minutes")
            AND reservation."scheduledAt" + make_interval(mins => reservation."durationMinutes")
              > slot."startsAt"
          LIMIT availability_window."capacity"
        ) bounded_reservations
      ) < availability_window."capacity"
    LIMIT 1
  ` as Array<{ available: boolean }>;
  return rows.length > 0;
}
