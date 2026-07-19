import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcrypt";

import { PrismaClient } from "../../generated/prisma/client";
import { encryptTotpSecret, normalizeBase32Secret } from "../auth/staff-auth.crypto";
import { validateEnvironment } from "../config/configuration";

const environment = validateEnvironment(process.env);
const prisma = new PrismaClient({ adapter: new PrismaPg(environment.DATABASE_URL) });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validatePassword(password: string, username: string): void {
  const categories = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (password.length < 16 || password.length > 128 || categories < 3) {
    throw new Error("STAFF_BOOTSTRAP_PASSWORD must be 16-128 characters and use at least three character categories");
  }
  if (password.toLowerCase().includes(username.toLowerCase())) {
    throw new Error("STAFF_BOOTSTRAP_PASSWORD must not contain the username");
  }
}

async function main(): Promise<void> {
  const username = required("STAFF_BOOTSTRAP_USERNAME").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) {
    throw new Error("STAFF_BOOTSTRAP_USERNAME must be 3-80 lowercase letters, digits, dots, underscores, or hyphens");
  }
  const password = required("STAFF_BOOTSTRAP_PASSWORD");
  validatePassword(password, username);
  const totpSecret = normalizeBase32Secret(required("STAFF_BOOTSTRAP_TOTP_SECRET"));
  const role = required("STAFF_BOOTSTRAP_ROLE");
  if (role !== "admin" && role !== "moderator") {
    throw new Error("STAFF_BOOTSTRAP_ROLE must be admin or moderator");
  }
  const displayName = process.env.STAFF_BOOTSTRAP_DISPLAY_NAME?.trim() || username;
  const passwordHash = await bcrypt.hash(password, 12);
  const totpSecretCiphertext = encryptTotpSecret(totpSecret, environment.STAFF_TOTP_ENCRYPTION_KEY);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.staffCredential.findUnique({ where: { username } });
    if (existing) {
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          role,
          accountStatus: "active",
          profile: {
            upsert: {
              create: { displayName, isVerified: true, safetyScore: 100 },
              update: { displayName, isVerified: true }
            }
          }
        }
      });
      await tx.staffCredential.update({
        where: { id: existing.id },
        data: { passwordHash, totpSecretCiphertext, failedAttempts: 0, lockedUntil: null }
      });
      await tx.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      return;
    }

    await tx.user.create({
      data: {
        role,
        accountStatus: "active",
        profile: { create: { displayName, isVerified: true, safetyScore: 100 } },
        staffCredential: {
          create: { username, passwordHash, totpSecretCiphertext }
        }
      }
    });
  });

  process.stdout.write(`Staff credential provisioned: ${username} (${role})\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
