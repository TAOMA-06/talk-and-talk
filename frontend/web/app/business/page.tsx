import type { Metadata } from "next";

import BusinessScreen from "../../components/BusinessScreen";

export const metadata: Metadata = {
  title: "平台与合作",
  description: "了解 Talk&Talk 的双边平台价值、商业化路径、治理闭环、合作入口与产品准备度。",
  alternates: { canonical: "/business" },
  openGraph: {
    title: "Talk&Talk 平台与合作",
    description: "了解双边平台价值、治理闭环与证据边界清楚的合作路径。",
    url: "/business",
  },
};

export default function BusinessPage() {
  return <BusinessScreen />;
}
