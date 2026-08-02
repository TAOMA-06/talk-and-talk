"use client";

import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  HelpCircle,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { requestApi } from "../lib/api-client";
import { currency, dateTime, ORDER_STATUS, orderTitle, pickList, readableError } from "../lib/format";
import type { Order } from "../lib/types";
import { useSession } from "./AppShell";
import { AuthWall, EmptyState, LoadingState, PageHeading, StatusBadge } from "./ui";
import WechatNativePayModal from "./WechatNativePayModal";

const filters = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

export default function OrdersScreen() {
  const { user } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [actingId, setActingId] = useState("");
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const result = await requestApi<{ items: Order[] }>("/orders");
      setOrders(pickList<Order>(result, ["items", "orders"]));
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(
    () =>
      orders.filter((order) => {
        if (filter === "all") return true;
        if (filter === "active") return ["pending", "paying", "paid", "inService"].includes(order.status);
        if (filter === "completed") return order.status === "completed";
        return ["cancelled", "refunded"].includes(order.status);
      }),
    [filter, orders],
  );

  async function act(order: Order, action: "cancel" | "sync" | "confirm") {
    setActingId(order.id);
    setError("");
    const endpoint =
      action === "cancel"
        ? `/orders/${encodeURIComponent(order.id)}/cancel`
        : action === "sync"
          ? `/orders/${encodeURIComponent(order.id)}/payment/sync`
          : `/orders/${encodeURIComponent(order.id)}/completion-confirmations`;
    try {
      await requestApi(endpoint, { method: "POST" });
      await load();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setActingId("");
    }
  }

  if (!user) {
    return (
      <div className="content-page orders-page">
        <PageHeading
          eyebrow="我的预约"
          title="每一次服务，都有清楚的进度"
          description="订单、改约、支付、沟通和售后以服务端记录为准。"
        />
        <AuthWall title="登录后查看订单" description="这里仅展示属于你的预约与服务记录。" />
      </div>
    );
  }

  return (
    <div className="content-page orders-page">
      <PageHeading
        eyebrow="我的预约"
        title="订单与服务"
        description="每一步都以平台记录为准，浏览器提示不替代支付回调或人工处理。"
        action={
          <button className="button button-secondary button-compact" onClick={() => void load()}>
            <RefreshCw size={16} /> 刷新状态
          </button>
        }
      />

      <div className="order-toolbar">
        <div className="segmented-control">
          {filters.map((item) => (
            <button
              type="button"
              key={item.value}
              className={filter === item.value ? "active" : ""}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <Link href="/discover" className="text-link">预约新的陪伴 <ArrowRight size={16} /></Link>
      </div>

      {error && <div className="inline-notice error">{error}</div>}
      {notice && <div className="inline-notice success">{notice}</div>}
      {loading ? (
        <LoadingState label="正在读取订单状态…" />
      ) : filtered.length ? (
        <div className="order-list">
          {filtered.map((order) => {
            const status = ORDER_STATUS[order.status] || { label: order.status, tone: "muted" };
            const companionName = order.companionSnapshot?.name || order.companion?.name || "陪伴者";
            const initials = order.companionSnapshot?.initials || companionName.slice(0, 2);
            return (
              <article className="order-card" key={order.id}>
                <header className="order-card-header">
                  <div className="order-person">
                    <span className="order-avatar">{initials}</span>
                    <div><strong>{companionName}</strong><small>{orderTitle(order)}</small></div>
                  </div>
                  <StatusBadge label={status.label} tone={status.tone} />
                </header>
                <div className="order-detail-grid">
                  <div><CalendarDays size={17} /><span><small>服务时间</small><strong>{dateTime(order.scheduledAt)}</strong></span></div>
                  <div><Clock3 size={17} /><span><small>服务时长</small><strong>{order.durationMinutes} 分钟</strong></span></div>
                  <div><CreditCard size={17} /><span><small>订单金额</small><strong>{currency(order.amountCents)}</strong></span></div>
                </div>
                <div className="order-timeline-mini">
                  <span className="done"><i><CheckCircle2 size={13} /></i>订单创建</span>
                  <em />
                  <span className={order.companionConfirmedAt || !["pending", "cancelled"].includes(order.status) ? "done" : ""}>
                    <i>{order.companionConfirmedAt ? <CheckCircle2 size={13} /> : "2"}</i>陪伴者确认
                  </span>
                  <em />
                  <span className={["paid", "inService", "completed"].includes(order.status) ? "done" : ""}>
                    <i>{["paid", "inService", "completed"].includes(order.status) ? <CheckCircle2 size={13} /> : "3"}</i>完成支付
                  </span>
                  <em />
                  <span className={order.status === "completed" ? "done" : ""}>
                    <i>{order.status === "completed" ? <CheckCircle2 size={13} /> : "4"}</i>服务完成
                  </span>
                </div>
                <footer className="order-actions">
                  {order.conversationId && (
                    <Link
                      href={`/messages?conversation=${encodeURIComponent(order.conversationId)}`}
                      className="button button-secondary button-compact"
                    >
                      <MessageCircle size={16} /> 打开会话
                    </Link>
                  )}
                  {order.status === "pending" && (
                    <>
                      {order.companionConfirmedAt && (
                        <button
                          className="button button-primary button-compact"
                          onClick={() => setPaymentOrder(order)}
                        >
                          微信扫码支付
                        </button>
                      )}
                      <button
                        className="button button-ghost button-compact"
                        disabled={actingId === order.id}
                        onClick={() => void act(order, "cancel")}
                      >
                        取消订单
                      </button>
                    </>
                  )}
                  {order.status === "paying" && (
                    <>
                      <button
                        className="button button-secondary button-compact"
                        disabled={actingId === order.id}
                        onClick={() => void act(order, "sync")}
                      >
                        <RefreshCw size={15} /> 同步支付状态
                      </button>
                      <button className="button button-primary button-compact" onClick={() => setPaymentOrder(order)}>
                        继续支付
                      </button>
                    </>
                  )}
                  {order.status === "completed" && !order.customerConfirmedAt && (
                    <button
                      className="button button-primary button-compact"
                      disabled={actingId === order.id}
                      onClick={() => void act(order, "confirm")}
                    >
                      确认已完成
                    </button>
                  )}
                  <Link className="button button-ghost button-compact" href="/safety">
                    <HelpCircle size={16} /> 遇到问题
                  </Link>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={filter === "all" ? "还没有订单" : "没有这一状态的订单"}
          description={filter === "all" ? "找到适合你的陪伴者，选择服务和真实可约时间。" : "切换到其他状态查看。"}
          action={<Link href="/discover" className="button button-primary">去发现陪伴者</Link>}
        />
      )}

      {paymentOrder && (
        <WechatNativePayModal
          order={paymentOrder}
          onClose={() => setPaymentOrder(null)}
          onPaid={async () => {
            setNotice("支付已确认，订单状态已更新。");
            await load();
          }}
        />
      )}
    </div>
  );
}
