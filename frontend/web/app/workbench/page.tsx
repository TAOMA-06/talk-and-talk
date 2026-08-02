import type { Metadata } from "next";

import WorkbenchScreen from "../../components/WorkbenchScreen";

export const metadata: Metadata = {
  title: "陪伴者工作台",
  description: "管理服务商品、可约时间、预约和履约进度。",
  robots: { index: false, follow: false },
};

export default function WorkbenchPage() {
  return <WorkbenchScreen />;
}
