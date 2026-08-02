import type { Metadata } from "next";

import HowItWorksScreen from "../../components/HowItWorksScreen";

export const metadata: Metadata = {
  title: "产品如何运作",
  description: "了解 Talk&Talk 如何将发现、预约、交易、沟通与支持放在同一条可信陪伴链中。",
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    title: "Talk&Talk 产品如何运作",
    description: "了解发现、预约、履约与支持如何被同一条可信服务路径承接。",
    url: "/how-it-works",
  },
};

export default function HowItWorksPage() {
  return <HowItWorksScreen />;
}
