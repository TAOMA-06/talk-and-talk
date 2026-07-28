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
    throw new Error("REVIEW_BOOTSTRAP_PASSWORD must be 16-128 characters and use at least three character categories");
  }
  if (password.toLowerCase().includes(username.toLowerCase())) {
    throw new Error("REVIEW_BOOTSTRAP_PASSWORD must not contain the username");
  }
}

async function main(): Promise<void> {
  const username = required("REVIEW_BOOTSTRAP_USERNAME").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) {
    throw new Error("REVIEW_BOOTSTRAP_USERNAME must be 3-80 lowercase letters, digits, dots, underscores, or hyphens");
  }
  const password = required("REVIEW_BOOTSTRAP_PASSWORD");
  validatePassword(password, username);
  const totpSecret = normalizeBase32Secret(required("REVIEW_BOOTSTRAP_TOTP_SECRET"));
  const role = required("REVIEW_BOOTSTRAP_ROLE");
  if (role !== "reviewer" && role !== "lead") {
    throw new Error("REVIEW_BOOTSTRAP_ROLE must be reviewer or lead");
  }
  const displayName = process.env.REVIEW_BOOTSTRAP_DISPLAY_NAME?.trim() || username;
  const passwordHash = await bcrypt.hash(password, 12);
  const totpSecretCiphertext = encryptTotpSecret(totpSecret, environment.REVIEW_TOTP_ENCRYPTION_KEY);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.reviewStaff.findUnique({ where: { username } });
    if (existing) {
      await tx.reviewStaff.update({
        where: { id: existing.id },
        data: {
          displayName,
          role,
          status: "active",
          passwordHash,
          totpSecretCiphertext,
          failedAttempts: 0,
          lockedUntil: null
        }
      });
      await tx.reviewSession.updateMany({
        where: { reviewerId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      return;
    }
    await tx.reviewStaff.create({
      data: { username, displayName, role, passwordHash, totpSecretCiphertext }
    });
  });

  process.stdout.write(`Review staff credential provisioned: ${username} (${role})\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
