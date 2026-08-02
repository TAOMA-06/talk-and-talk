/**
 * Talk&Talk Web root layout.
 * Web brand (fog white + deep navy + mist teal + Fraunces display) is independent of
 * iOS DesignSystem — cross-platform visual divergence is intentional.
 */
import type { Metadata } from "next";
import { Fraunces, Noto_Sans_SC } from "next/font/google";
import AppShell from "../components/AppShell";
import { publicDisclosure } from "../lib/public-disclosure";
import "./globals.css";

const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const bodyFont = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const siteOrigin = new URL("https://talkandtalk.app");
const socialImage = new URL("/og-trust-path.png", siteOrigin).toString();

// The public marketing site has one canonical origin. Keeping metadata static
// lets its pages remain cacheable and prevents an arbitrary request Host from
// changing the brand's social URLs.
export const metadata: Metadata = {
  metadataBase: siteOrigin,
  title: {
      default: "Talk&Talk｜让每一次倾听，都有安心的边界",
      template: "%s｜Talk&Talk",
  },
  description: "Talk&Talk 官方网站。女性友好的线上陪伴平台；网页用于了解产品与体验路径，服务入口以微信小程序页面状态为准。",
  keywords: ["线上陪伴", "情绪倾听", "女性友好", "睡前陪伴", "职场减压", "Talk&Talk官网"],
  alternates: {
    canonical: siteOrigin.toString(),
  },
  openGraph: {
    title: "Talk&Talk｜认真听你说，也认真守住边界",
    description: "发现合适的线上陪伴者，平台内预约、沟通与服务。",
    type: "website",
    locale: "zh_CN",
    url: siteOrigin.toString(),
    siteName: "Talk&Talk",
    images: [
      {
        url: socialImage,
        width: 1774,
        height: 887,
        alt: "Talk&Talk｜有边界的线上陪伴服务路径",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Talk&Talk｜认真听你说，也认真守住边界",
    description: "女性友好的线上陪伴服务。",
    images: [socialImage],
  },
  robots: {
    index: true,
    follow: true,
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Talk&Talk",
      url: "https://talkandtalk.app",
      description: "女性友好的线上陪伴平台官方网站",
      ...(publicDisclosure.operatorName ? { legalName: publicDisclosure.operatorName } : {}),
      ...(publicDisclosure.contactEmail || publicDisclosure.contactPhone
        ? {
            contactPoint: {
              "@type": "ContactPoint",
              contactType: "customer support",
              ...(publicDisclosure.contactEmail ? { email: publicDisclosure.contactEmail } : {}),
              ...(publicDisclosure.contactPhone ? { telephone: publicDisclosure.contactPhone } : {}),
            },
          }
        : {}),
    },
    {
      "@type": "WebSite",
      name: "Talk&Talk",
      url: "https://talkandtalk.app",
      inLanguage: "zh-CN",
      description: "Talk&Talk 官方网站：有边界的线上陪伴",
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
