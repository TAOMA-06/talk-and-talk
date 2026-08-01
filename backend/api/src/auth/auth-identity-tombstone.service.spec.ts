import { createHmac } from "node:crypto";

import { ConfigService } from "@nestjs/config";

import { AuthIdentityTombstoneService } from "./auth-identity-tombstone.service";

const key = Buffer.alloc(32, 7);
const keyring = JSON.stringify({ "key-v1": key.toString("base64") });

function digest(provider: string, providerId: string): string {
  return createHmac("sha256", key)
    .update(`talk-and-talk-auth-tombstone-v1\0${provider}\0${providerId}`, "utf8")
    .digest("hex");
}

function makeService(): AuthIdentityTombstoneService {
  return new AuthIdentityTombstoneService({
    get: jest.fn((name: string) => ({
      AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: keyring,
      AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: "key-v1",
      NODE_ENV: "test"
    })[name])
  } as unknown as ConfigService);
}

describe("AuthIdentityTombstoneService", () => {
  it("persists only a domain-separated HMAC and verifies it before deletion starts", async () => {
    const service = makeService();
    const expected = digest("phone", "+8613800138000");
    const tx: any = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{
          id: "identity-1",
          provider: "phone",
          providerId: "+8613800138000"
        }])
        .mockResolvedValueOnce([{
          id: "identity-1",
          provider: "phone",
          providerId: "+8613800138000",
          tombstoneId: "tombstone-1",
          tombstoneProvider: "phone",
          providerIdHmac: expected,
          keyId: "key-v1"
        }]),
      authIdentityTombstone: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1)
      }
    };

    await expect(service.installForDeletionTx(
      tx,
      "deletion-1",
      "user-1",
      new Date("2026-08-01T00:00:00.000Z")
    )).resolves.toBe(1);

    const row = tx.authIdentityTombstone.createMany.mock.calls[0][0].data[0];
    expect(row).toMatchObject({
      provider: "phone",
      keyId: "key-v1",
      providerIdHmac: expected
    });
    expect(JSON.stringify(row)).not.toContain("+8613800138000");
  });

  it("fails closed when a tombstone has the right provenance but the wrong digest", async () => {
    const service = makeService();
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{
        id: "identity-1",
        provider: "wechatMiniProgram",
        providerId: "openid-1",
        tombstoneId: "tombstone-1",
        tombstoneProvider: "wechatMiniProgram",
        providerIdHmac: "0".repeat(64),
        keyId: "key-v1"
      }]),
      authIdentityTombstone: { count: jest.fn().mockResolvedValue(1) }
    };

    await expect(service.assertWorkerCoverageTx(tx, "deletion-1", "user-1"))
      .rejects.toThrow("missing tombstone coverage");
  });

  it("fails closed for a tombstone signed by an unknown or retired key", async () => {
    const service = makeService();
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{
        id: "identity-1",
        provider: "apple",
        providerId: "apple-sub-1",
        tombstoneId: "tombstone-1",
        tombstoneProvider: "apple",
        providerIdHmac: "0".repeat(64),
        keyId: "unknown-key"
      }]),
      authIdentityTombstone: { count: jest.fn().mockResolvedValue(1) }
    };

    await expect(service.assertCoverageTx(tx, "deletion-1", "user-1"))
      .rejects.toMatchObject({ code: "ACCOUNT_DELETION_AUTH_TOMBSTONE_INCOMPLETE" });
  });

  it("returns a generic login conflict without exposing a previous account state", () => {
    const service = makeService();

    expect(() => service.throwAuthState({
      status: "completed",
      dueAt: "2026-08-01T00:00:00.000Z",
      overdue: false,
      completedAt: "2026-08-01T00:00:00.000Z",
      policyVersion: "v1",
      canCancel: false,
      reRegistrationPolicy: "after_tombstone_expiry",
      reRegistrationAllowedAt: "2027-08-01T00:00:00.000Z"
    })).toThrow(expect.objectContaining({
      code: "LOGIN_IDENTITY_UNAVAILABLE",
      details: undefined
    }));
  });

  it("fails every absent-identity registration closed while an active unknown key exists", async () => {
    const service = makeService();
    const tx: any = {
      authIdentityTombstone: {
        findFirst: jest.fn().mockResolvedValue({ id: "unknown-key-tombstone" })
      }
    };

    await expect(service.findBlockingStateTx(
      tx,
      "phone",
      "+8613800138000",
      new Date("2026-08-01T00:00:00.000Z")
    )).rejects.toMatchObject({
      code: "AUTH_IDENTITY_TOMBSTONE_KEY_COVERAGE_UNKNOWN",
      status: 503
    });
    expect(tx.authIdentityTombstone.findFirst).toHaveBeenCalledTimes(1);
  });

  it("keeps processing tombstones active regardless of expiry", async () => {
    const service = makeService();
    const now = new Date("2026-08-01T00:00:00.000Z");
    const findFirst = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        expiresAt: new Date("2026-07-01T00:00:00.000Z"),
        deletionRequest: {
          status: "processing",
          dueAt: new Date("2026-07-02T00:00:00.000Z"),
          completedAt: null,
          policyVersion: "v1"
        }
      });
    const tx: any = { authIdentityTombstone: { findFirst } };

    await expect(service.findBlockingStateTx(tx, "apple", "apple-sub-1", now))
      .resolves.toMatchObject({ status: "processing" });
    expect(findFirst.mock.calls[1][0].where.AND[1]).toEqual({
      OR: [
        { deletionRequest: { status: "processing" } },
        {
          deletionRequest: { status: "completed" },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        }
      ]
    });
  });

  it("allows completed re-registration at the exact expiry boundary", async () => {
    const service = makeService();
    const now = new Date("2026-08-01T00:00:00.000Z");
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const tx: any = { authIdentityTombstone: { findFirst } };

    await expect(service.findBlockingStateTx(tx, "wechatMiniProgram", "openid-1", now))
      .resolves.toBeNull();
    const completedBranch = findFirst.mock.calls[1][0].where.AND[1].OR[1];
    expect(completedBranch.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: now } }
    ]);
  });
});
