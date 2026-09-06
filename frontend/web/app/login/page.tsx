import type { Metadata } from "next";

import { enforcePageSurface } from "../../lib/enforce-web-surface";
import LoginScreen from "../../components/LoginScreen";
import { redirect } from "next/navigation";
import { isPartnerPreviewEnabled } from "../../lib/partner-preview";

export const metadata: Metadata = {
  title: "登录",
  description: "使用手机号验证码安全登录 Talk&Talk。",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  enforcePageSurface("/login");
  if (isPartnerPreviewEnabled()) redirect("/mini/index.html");
  return <LoginScreen />;
}
