import type { Metadata } from "next";

import { enforcePageSurface } from "../../lib/enforce-web-surface";
import MessagesScreen from "../../components/MessagesScreen";

export const metadata: Metadata = {
  title: "消息",
  description: "在平台内与陪伴者安全沟通。",
  robots: { index: false, follow: false },
};

export default function MessagesPage() {
  enforcePageSurface("/messages");
  return <MessagesScreen />;
}
