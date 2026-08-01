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
