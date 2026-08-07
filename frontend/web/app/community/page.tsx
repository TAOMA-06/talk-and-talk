import type { Metadata } from "next";

import { enforcePageSurface } from "../../lib/enforce-web-surface";
import CommunityScreen from "../../components/CommunityScreen";

export const metadata: Metadata = {
  title: "广场",
  description: "表达此刻的陪伴需求，在平台边界内遇见合适的人。",
  robots: { index: false, follow: false },
};

export default function CommunityPage() {
  enforcePageSurface("/community");
  return <CommunityScreen />;
}
