import { createHmac, timingSafeEqual } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  ACCOUNT_DELETION_RETENTION_CATEGORIES,
  retentionEndsAt
} from "../common/account-deletion-retention-policy";
import { AppException } from "../common/errors/app.exception";

export type ConsumerAuthProvider = "phone" | "apple" | "wechatMiniProgram";

export type AccountDeletionAuthState = {
  status: "processing" | "completed";
  dueAt: string;
  overdue: boolean;
  completedAt: string | null;
  policyVersion: string;
  canCancel: false;
  reRegistrationPolicy: "after_tombstone_expiry";
  reRegistrationAllowedAt: string | null;
};

type HmacKey = { keyId: string; key: Buffer };

type DeletionStateRecord = {
  status: string;
  dueAt: Date;
  completedAt: Date | null;
  policyVersion: string;
  authIdentityTombstones?: Array<{ expiresAt: Date | null }>;
};

const TEST_KEY_ID = "test-v1";
const TEST_KEY = Buffer.from("talk-and-talk-test-tombstone-key-v1", "utf8");

@Injectable()
export class AuthIdentityTombstoneService {
  constructor(private readonly config: ConfigService) {}

  async installForDeletionTx(
    tx: any,
    deletionRequestId: string,
    userId: string,
    createdAt: Date
  ): Promise<number> {
    const identities = await tx.$queryRaw<Array<{
      id: string;
      provider: ConsumerAuthProvider;
      providerId: string;
    }>>`
      SELECT "id", "provider", "providerId"
      FROM "AuthIdentity"
      WHERE "userId" = ${userId}
      ORDER BY "provider", "id"
      FOR UPDATE
    `;
    if (!identities.length) {
      throw new AppException(
        "ACCOUNT_DELETION_AUTH_IDENTITY_MISSING",
        "Account deletion cannot start without a verified login identity",
        HttpStatus.CONFLICT
      );
    }

    const active = this.activeKey();
    await tx.authIdentityTombstone.createMany({
      data: identities.map((identity: {
        id: string;
        provider: ConsumerAuthProvider;
        providerId: string;
      }) => ({
        deletionRequestId,
        sourceAuthIdentityId: identity.id,
        provider: identity.provider,
        providerIdHmac: this.digestWithKey(active.key, identity.provider, identity.providerId),
        keyId: active.keyId,
        createdAt,
        expiresAt: null
      })),
      skipDuplicates: true
    });
    await this.assertCoverageTx(tx, deletionRequestId, userId);
    return identities.length;
  }

  async assertCoverageTx(tx: any, deletionRequestId: string, userId: string): Promise<number> {
    const count = await this.verifyDigestCoverageTx(tx, deletionRequestId, userId);
    if (count === null) {
      throw new AppException(
        "ACCOUNT_DELETION_AUTH_TOMBSTONE_INCOMPLETE",
        "Account deletion authentication tombstones are incomplete",
        HttpStatus.CONFLICT
      );
    }
    return count;
  }

  async assertWorkerCoverageTx(tx: any, deletionRequestId: string, userId: string): Promise<void> {
    if (await this.verifyDigestCoverageTx(tx, deletionRequestId, userId) === null) {
      throw new Error("Account deletion auth identity erasure is missing tombstone coverage");
    }
  }

  async assertPersistedCoverageTx(
    tx: any,
    deletionRequestId: string,
    expectedDeletedIdentityCount: number,
    approvedAt: Date
  ): Promise<number> {
    const count = await tx.authIdentityTombstone.count({ where: { deletionRequestId } });
    const invalid = await tx.authIdentityTombstone.count({
      where: {
        deletionRequestId,
        OR: [
          { expiresAt: null },
          { expiresAt: { lte: approvedAt } },
          { keyId: { notIn: this.configuredKeyIds() } }
        ]
      }
    });
    if (count < 1 || count !== expectedDeletedIdentityCount || invalid !== 0) {
      throw new Error("Account deletion auth tombstone final postcondition failed");
    }
    return count;
  }

  async sealExpiryForDeletionTx(
    tx: any,
    deletionRequestId: string,
    approvedAt: Date
  ): Promise<Date> {
    const retention = ACCOUNT_DELETION_RETENTION_CATEGORIES.find(
      (entry) => entry.code === "deletion_audit_evidence"
    );
    if (!retention) throw new Error("Deletion-audit retention category is missing");
    const expiresAt = retentionEndsAt(approvedAt, retention.retentionDays);
    const updated = await tx.authIdentityTombstone.updateMany({
      where: { deletionRequestId, expiresAt: null },
      data: { expiresAt }
    });
    const total = await tx.authIdentityTombstone.count({ where: { deletionRequestId } });
    if (total < 1 || (updated.count !== 0 && updated.count !== total)) {
      throw new Error("Account deletion auth tombstone expiry could not be sealed atomically");
    }
    const invalid = await tx.authIdentityTombstone.count({
      where: { deletionRequestId, expiresAt: { not: expiresAt } }
    });
    if (invalid !== 0) throw new Error("Account deletion auth tombstone expiry is inconsistent");
    return expiresAt;
  }

  async findBlockingStateTx(
    tx: any,
    provider: ConsumerAuthProvider,
    providerId: string,
    now: Date
  ): Promise<AccountDeletionAuthState | null> {
    await this.assertConfiguredActiveKeyCoverageTx(tx, now);
    const candidates = this.keys().map((entry) => ({
      keyId: entry.keyId,
      providerIdHmac: this.digestWithKey(entry.key, provider, providerId)
    }));
    const tombstone = await tx.authIdentityTombstone.findFirst({
      where: {
        provider,
        AND: [
          { OR: candidates },
          {
            OR: [
              { deletionRequest: { status: "processing" } },
              {
                deletionRequest: { status: "completed" },
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
              }
            ]
          }
        ]
      },
      select: {
        expiresAt: true,
        deletionRequest: {
          select: {
            status: true,
            dueAt: true,
            completedAt: true,
            policyVersion: true
          }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    if (!tombstone) return null;
    return this.toPublicState(tombstone.deletionRequest, tombstone.expiresAt, now);
  }

  async findUserBlockingStateTx(
    tx: any,
    userId: string,
    now: Date
  ): Promise<AccountDeletionAuthState | null> {
    const request = await tx.accountDeletionRequest.findFirst({
      where: { userId, status: { in: ["processing", "completed"] } },
      select: {
        status: true,
        dueAt: true,
        completedAt: true,
        policyVersion: true,
        authIdentityTombstones: {
          select: { expiresAt: true },
          orderBy: [{ expiresAt: "desc" }, { id: "desc" }],
          take: 1
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    if (!request) return null;
    return this.toPublicState(
      request,
      request.authIdentityTombstones[0]?.expiresAt ?? null,
      now
    );
  }

  throwAuthState(_state: AccountDeletionAuthState): never {
    throw new AppException(
      "LOGIN_IDENTITY_UNAVAILABLE",
      "This login identifier is temporarily unavailable. Contact support for help.",
      HttpStatus.CONFLICT
    );
  }

  configuredKeyIds(): string[] {
    return this.keys().map((entry) => entry.keyId);
  }

  private toPublicState(
    request: DeletionStateRecord,
    expiresAt: Date | null,
    now: Date
  ): AccountDeletionAuthState {
    if (request.status !== "processing" && request.status !== "completed") {
      throw new Error("Unsupported account deletion authentication state");
    }
    return {
      status: request.status,
      dueAt: request.dueAt.toISOString(),
      overdue: request.status !== "completed" && request.dueAt.getTime() < now.getTime(),
      completedAt: request.completedAt?.toISOString() ?? null,
      policyVersion: request.policyVersion,
      canCancel: false,
      reRegistrationPolicy: "after_tombstone_expiry",
      reRegistrationAllowedAt: request.status === "completed"
        ? expiresAt?.toISOString() ?? null
        : null
    };
  }

  private activeKey(): HmacKey {
    const activeKeyId = this.config.get<string>("AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID")?.trim()
      || (this.isTestEnvironment() ? TEST_KEY_ID : "");
    const key = this.keys().find((entry) => entry.keyId === activeKeyId);
    if (!key) {
      throw new AppException(
        "AUTH_IDENTITY_TOMBSTONE_CONFIGURATION_INVALID",
        "Account deletion identity protection is unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return key;
  }

  private async verifyDigestCoverageTx(
    tx: any,
    deletionRequestId: string,
    userId: string
  ): Promise<number | null> {
    const identities = await tx.$queryRaw<Array<{
      id: string;
      provider: ConsumerAuthProvider;
      providerId: string;
      tombstoneId: string | null;
      tombstoneProvider: ConsumerAuthProvider | null;
      providerIdHmac: string | null;
      keyId: string | null;
    }>>`
      SELECT
        identity."id",
        identity."provider",
        identity."providerId",
        tombstone."id" AS "tombstoneId",
        tombstone."provider" AS "tombstoneProvider",
        tombstone."providerIdHmac",
        tombstone."keyId"
      FROM "AuthIdentity" identity
      LEFT JOIN "AuthIdentityTombstone" tombstone
        ON tombstone."deletionRequestId" = ${deletionRequestId}
       AND tombstone."sourceAuthIdentityId" = identity."id"
      WHERE identity."userId" = ${userId}
      ORDER BY identity."provider", identity."id"
    `;
    if (!identities.length) return null;

    const tombstoneCount = await tx.authIdentityTombstone.count({
      where: { deletionRequestId }
    });
    if (tombstoneCount !== identities.length) return null;

    const keys = new Map(this.keys().map((entry) => [entry.keyId, entry.key]));
    for (const identity of identities) {
      if (!identity.tombstoneId
        || identity.tombstoneProvider !== identity.provider
        || !identity.keyId
        || !identity.providerIdHmac) {
        return null;
      }
      const key = keys.get(identity.keyId);
      if (!key) return null;
      const expected = this.digestWithKey(key, identity.provider, identity.providerId);
      const observed = identity.providerIdHmac;
      if (observed.length !== expected.length
        || !timingSafeEqual(Buffer.from(observed, "utf8"), Buffer.from(expected, "utf8"))) {
        return null;
      }
    }
    return identities.length;
  }

  private async assertConfiguredActiveKeyCoverageTx(tx: any, now: Date): Promise<void> {
    const unknown = await tx.authIdentityTombstone.findFirst({
      where: {
        keyId: { notIn: this.configuredKeyIds() },
        OR: [
          { deletionRequest: { status: "processing" } },
          {
            deletionRequest: { status: "completed" },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
          }
        ]
      },
      select: { id: true }
    });
    if (unknown) {
      throw new AppException(
        "AUTH_IDENTITY_TOMBSTONE_KEY_COVERAGE_UNKNOWN",
        "Login identity protection is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private keys(): HmacKey[] {
    const raw = this.config.get<string>("AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS")?.trim();
    if (!raw && this.isTestEnvironment()) return [{ keyId: TEST_KEY_ID, key: TEST_KEY }];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw || "");
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return this.configurationFailure();
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (!entries.length) return this.configurationFailure();
    const keys = entries.map(([keyId, encoded]) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId) || typeof encoded !== "string") {
        return null;
      }
      const key = Buffer.from(encoded, "base64");
      if (key.length < 32 || key.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")) {
        return null;
      }
      return { keyId, key };
    });
    if (keys.some((entry) => !entry)) return this.configurationFailure();
    return keys as HmacKey[];
  }

  private configurationFailure(): never {
    throw new AppException(
      "AUTH_IDENTITY_TOMBSTONE_CONFIGURATION_INVALID",
      "Account deletion identity protection is unavailable",
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }

  private isTestEnvironment(): boolean {
    return this.config.get<string>("NODE_ENV") === "test" || process.env.NODE_ENV === "test";
  }

  private digestWithKey(
    key: Buffer,
    provider: ConsumerAuthProvider,
    providerId: string
  ): string {
    return createHmac("sha256", key)
      .update(`talk-and-talk-auth-tombstone-v1\0${provider}\0${providerId}`, "utf8")
      .digest("hex");
  }
}
