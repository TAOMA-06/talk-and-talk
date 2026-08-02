import type { Metadata } from "next";

import PartnersScreen from "../../components/PartnersScreen";

export const metadata: Metadata = {
  title: "合作与联系",
  description: "了解 Talk&Talk 面向陪伴者、组织、社群、媒体与行业交流的合作原则与联系渠道。",
  alternates: { canonical: "/partners" },
  openGraph: {
    title: "Talk&Talk 合作与联系",
    description: "从服务边界、隐私责任与真实履约价值开始讨论合作。",
    url: "/partners",
  },
};

export default function PartnersPage() {
  return <PartnersScreen />;
}
