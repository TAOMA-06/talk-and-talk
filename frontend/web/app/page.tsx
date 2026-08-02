import type { Metadata } from "next";

import MarketingHomeScreen from "../components/MarketingHomeScreen";

export const metadata: Metadata = {
  title: "Talk&Talk 官方网站｜有边界的陪伴",
  description:
    "Talk&Talk 官方网站。了解女性友好的线上陪伴产品如何通过清楚的规则、平台内沟通与支持路径承接每一次连接。",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return <MarketingHomeScreen />;
}
