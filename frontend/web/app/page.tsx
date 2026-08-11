import type { Metadata } from "next";

import MarketingHomeScreen from "../components/MarketingHomeScreen";

export const metadata: Metadata = {
  // Absolute title: root layout uses `template: "%s｜Talk&Talk"` for child routes.
  title: {
    absolute: "Talk&Talk 官方网站｜有边界的陪伴",
  },
  description:
    "Talk&Talk 官方网站。女性友好的线上陪伴平台：有边界的线上陪伴，从被认真听见开始。官网说明规则与边界；当前真实服务请在微信小程序内完成文字互动。",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Talk&Talk｜有边界的线上陪伴，从被认真听见开始",
    description:
      "女性友好的线上陪伴平台官方网站。了解产品路径与边界；服务入口以微信小程序内的文字互动页面为准。",
    url: "/",
  },
};

export default function Home() {
  return <MarketingHomeScreen />;
}
