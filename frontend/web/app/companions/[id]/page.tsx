import type { Metadata } from "next";

import CompanionDetailScreen from "../../../components/CompanionDetailScreen";

export const metadata: Metadata = {
  title: "陪伴者资料",
  description: "查看陪伴者公开资料、服务与页面展示的可约信息。",
  robots: { index: false, follow: false },
};

export default async function CompanionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CompanionDetailScreen id={id} />;
}
