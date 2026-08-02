import type { Metadata } from "next";

import SafetyScreen from "../../components/SafetyScreen";

export const metadata: Metadata = {
  title: "安全与支持",
  description: "了解平台内沟通、举报、售后与紧急场景边界。",
  alternates: { canonical: "/safety" },
  openGraph: {
    title: "Talk&Talk 安全与支持",
    description: "了解平台内沟通、订单支持、举报与紧急场景的边界。",
    url: "/safety",
  },
};

export default function SafetyPage() {
  return <SafetyScreen />;
}
