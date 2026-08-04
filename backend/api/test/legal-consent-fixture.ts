import { randomUUID } from "node:crypto";

import { PrismaService } from "../src/database/prisma.service";

export async function grantCurrentLegalConsent(prisma: PrismaService, userId: string) {
  return prisma.legalConsentReceipt.create({
    data: {
      userId,
      version: "2.2-2026-08-01",
      privacyVersion: "2.2-2026-08-01",
      termsVersion: "2.2-2026-08-01",
      privacyAccepted: true,
      termsAccepted: true,
      adultConfirmed: true,
      acceptedAt: new Date(),
      privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
      termsUrl: "https://api.talkandtalk.app/legal/terms.html",
      source: "wechatMiniProgram"
    }
  });
}

/**
 * Order intake requires a current dual-control adult-eligibility record.
 * Legal consent checkboxes alone are never consulted for paid services.
 */
export async function grantCurrentCustomerAdultEligibility(
  prisma: PrismaService,
  userId: string
) {
  // Subject must self-submit; a different staff reviewer must approve.
  const reviewer = await prisma.user.create({
    data: {
      role: "supply",
      profile: {
        create: {
          displayName: "E2E 成年复核员",
          isVerified: true
        }
      },
      staffCredential: {
        create: {
          username: `e2e-adult-${randomUUID().slice(0, 10)}`,
          passwordHash: "e2e-irreversible-password-hash",
          totpSecretCiphertext: "e2e-encrypted-totp-secret",
          status: "active"
        }
      }
    } as any
  });
  const now = new Date();
  return prisma.customerAdultEligibility.create({
    data: {
      userId,
      status: "adult",
      verificationMethod: "secureManualReview",
      evidenceReference: `e2e:adult-${randomUUID().slice(0, 23)}`,
      submittedById: userId,
      reviewedById: reviewer.id,
      verifiedAt: now,
      validUntil: new Date(now.getTime() + 180 * 24 * 60 * 60_000),
      reviewReason: "e2e adult eligibility fixture"
    } as any
  });
}
