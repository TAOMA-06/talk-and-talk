import type { Metadata } from "next";

import LoginScreen from "../../components/LoginScreen";

export const metadata: Metadata = {
  title: "登录",
  description: "使用手机号验证码安全登录 Talk&Talk。",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginScreen />;
}
