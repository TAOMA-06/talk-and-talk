import type { Metadata } from "next";

import DemoExperience, { type DemoStageId } from "../../components/DemoExperience";

const demoStages: DemoStageId[] = ["discover", "booking", "delivery", "support"];

function isDemoStageId(value: string | undefined): value is DemoStageId {
  return demoStages.some((stage) => stage === value);
}

export const metadata: Metadata = {
  title: "网页产品演示",
  description: "以脱敏、只读方式了解 Talk&Talk 如何连接发现、约定、履约与平台支持。",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Talk&Talk 网页产品演示",
    description: "无需登录，了解可信服务路径如何连接用户体验、履约与支持。",
    url: "/demo",
  },
};

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const { stage } = await searchParams;
  return <DemoExperience initialStageId={isDemoStageId(stage) ? stage : undefined} />;
}
