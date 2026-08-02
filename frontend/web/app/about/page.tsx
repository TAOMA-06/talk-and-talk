import type { Metadata } from "next";

import AboutScreen from "../../components/AboutScreen";

export const metadata: Metadata = {
  title: "关于我们",
  description: "了解 Talk&Talk 的使命、产品边界与官方说明。用户服务入口以微信小程序页面状态为准。",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "关于 Talk&Talk",
    description: "了解我们的产品边界、可信服务原则与官方说明。",
    url: "/about",
  },
};

export default function AboutPage() {
  return <AboutScreen />;
}
