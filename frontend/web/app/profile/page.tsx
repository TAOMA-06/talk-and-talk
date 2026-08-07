import type { Metadata } from "next";

import { enforcePageSurface } from "../../lib/enforce-web-surface";
import ProfileScreen from "../../components/ProfileScreen";

export const metadata: Metadata = {
  title: "我的",
  description: "管理个人资料、推荐偏好、书签、通知和陪伴者工作台。",
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  enforcePageSurface("/profile");
  return <ProfileScreen />;
}
