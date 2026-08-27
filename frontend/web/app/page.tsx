import type { Metadata } from "next";

import MarketingHomeScreen from "../components/MarketingHomeScreen";

export const metadata: Metadata = {
  // Absolute title: root layout uses `template: "%s｜Talk&Talk"` for child routes.
  title: {
    absolute: "Talk&Talk 官方网站｜有边界的陪伴",
  },
  description:
    "Talk&Talk 官方网站。女性友好的线上陪伴平台：有边界的线上陪伴，从被认真听见开始。官网说明规则与边界；文字互动开放状态以微信小程序为准，身份核验通道完成前不开放新预约、支付或聊天。",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Talk&Talk｜有边界的线上陪伴，从被认真听见开始",
    description:
      "女性友好的线上陪伴平台官方网站。了解产品路径与边界；身份核验通道完成前不开放新预约、支付或聊天。",
    url: "/",
  },
};

export default function Home() {
  return <MarketingHomeScreen />;
}
