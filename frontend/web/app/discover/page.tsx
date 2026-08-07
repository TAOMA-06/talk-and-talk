import type { Metadata } from "next";

import { enforcePageSurface } from "../../lib/enforce-web-surface";
import DiscoverScreen from "../../components/DiscoverScreen";

export const metadata: Metadata = {
  title: "发现陪伴",
  description: "按主题、服务方式和页面展示的可约信息了解陪伴路径，并在平台内查看相关规则。",
  robots: { index: false, follow: false },
};

export default function DiscoverPage() {
  enforcePageSurface("/discover");
  return <DiscoverScreen />;
}
