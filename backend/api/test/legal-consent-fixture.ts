import { PrismaService } from "../src/database/prisma.service";

export async function grantCurrentLegalConsent(prisma: PrismaService, userId: string) {
  return prisma.legalConsentReceipt.create({
    data: {
      userId,
      version: "1.0-2026-07-19",
      privacyVersion: "1.0-2026-07-19",
      termsVersion: "1.0-2026-07-19",
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
