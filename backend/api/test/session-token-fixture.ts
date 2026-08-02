import { createHash, randomUUID } from "node:crypto";

import { JwtService } from "@nestjs/jwt";

import { isStaffUserRole } from "../src/auth/staff-roles";
import { PrismaService } from "../src/database/prisma.service";

/** Minimal refund-policy snapshots required by Order create after commercial freeze. */
export const E2E_ORDER_REFUND_POLICY_SNAPSHOT = {
  refundPolicyVersionSnapshot: "e2e-test-v1",
  refundRequestWindowHoursSnapshot: 72
} as const;

/**
 * Staff JWTs require an active StaffCredential row. Callers that mint admin
 * tokens for e2e must provision this first or JwtStrategy returns 401.
 */
export async function ensureActiveStaffCredential(
  prisma: PrismaService,
  user: { id: string; role: string },
  usernameSuffix?: string
) {
  if (!isStaffUserRole(user.role)) return null;
  const username = `e2e-staff-${usernameSuffix ?? user.id.slice(0, 8)}`;
  return prisma.staffCredential.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      username,
      passwordHash: "e2e-irreversible-password-hash",
      totpSecretCiphertext: "e2e-encrypted-totp-secret",
      status: "active"
    },
    update: {
      status: "active",
      suspendedAt: null,
      suspendedByUserId: null,
      suspensionReason: null
    }
  } as any);
}

export async function issueSessionBoundAccessToken(
  prisma: PrismaService,
  jwt: JwtService,
  user: { id: string; role: string }
): Promise<string> {
  if (isStaffUserRole(user.role)) {
    await ensureActiveStaffCredential(prisma, user);
  }
  const sessionId = randomUUID();
  const now = new Date();
  await prisma.refreshToken.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash: createHash("sha256").update(`e2e:${sessionId}`).digest("hex"),
      sessionLabel: "E2E session",
      clientPlatform: "jest",
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000)
    }
  });
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      sid: sessionId,
      kind: isStaffUserRole(user.role) ? "staff" : "consumer",
      jti: randomUUID()
    },
    { secret: "e2e-access-secret", expiresIn: "15m" }
  );
}
