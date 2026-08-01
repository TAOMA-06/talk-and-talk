import { createHash, randomUUID } from "node:crypto";

import { JwtService } from "@nestjs/jwt";

import { isStaffUserRole } from "../src/auth/staff-roles";
import { PrismaService } from "../src/database/prisma.service";

export async function issueSessionBoundAccessToken(
  prisma: PrismaService,
  jwt: JwtService,
  user: { id: string; role: string }
): Promise<string> {
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
