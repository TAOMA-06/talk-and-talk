import type { Metadata } from "next";

import AboutScreen from "../../components/AboutScreen";

export const metadata: Metadata = {
  title: "关于我们",
  description:
    "了解 Talk&Talk：女性友好的线上陪伴平台。产品边界、公开信息与官方说明。服务入口以微信小程序页面状态为准。",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "关于 Talk&Talk｜有边界的线上陪伴",
    description: "了解产品边界、可信服务原则与官方说明。服务入口以微信小程序为准。",
    url: "/about",
  },
};

export default function AboutPage() {
  return <AboutScreen />;
}
