import { PrismaService } from "../src/database/prisma.service";

export async function grantCurrentLegalConsent(prisma: PrismaService, userId: string) {
  return prisma.legalConsentReceipt.create({
    data: {
      userId,
      version: "2.0-2026-07-20",
      privacyVersion: "2.0-2026-07-20",
      termsVersion: "2.0-2026-07-20",
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
