import type { Metadata } from "next";

import OrdersScreen from "../../components/OrdersScreen";

export const metadata: Metadata = {
  title: "订单",
  description: "查看预约、支付、服务和售后状态。",
  robots: { index: false, follow: false },
};

export default function OrdersPage() {
  return <OrdersScreen />;
}
