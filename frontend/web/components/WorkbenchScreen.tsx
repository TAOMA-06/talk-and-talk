"use client";

import {
  BriefcaseBusiness,
  CalendarClock,
  Clock3,
  Coins,
  MessageCircleMore,
  PackagePlus,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { requestApi } from "../lib/api-client";
import { currency, dateTime, ORDER_STATUS, orderTitle, pickList, readableError } from "../lib/format";
import type {
  Companion,
  CompanionTodaySchedule,
  Order,
  ServiceOffering,
} from "../lib/types";
import { useSession } from "./AppShell";
import { AuthWall, EmptyState, LoadingState, PageHeading, StatusBadge } from "./ui";

type AvailabilityWindow = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  isActive: boolean;
};

export default function WorkbenchScreen() {
  const { user } = useSession();
  const [profile, setProfile] = useState<Companion | null>(null);
  const [services, setServices] = useState<ServiceOffering[]>([]);
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [today, setToday] = useState<CompanionTodaySchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acting, setActing] = useState("");
  const [serviceModal, setServiceModal] = useState(false);
  const [availabilityModal, setAvailabilityModal] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (user?.role !== "companion") return;
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      requestApi<Companion>("/companions/me/profile"),
      requestApi<{ items: ServiceOffering[] }>("/companions/me/service-offerings"),
      requestApi<{ items: AvailabilityWindow[] }>("/companions/me/availability-windows"),
      requestApi<{ items: Order[] }>("/orders/service"),
      requestApi<CompanionTodaySchedule>("/orders/service/today"),
    ]);
    if (results[0].status === "fulfilled") setProfile(results[0].value);
    else setError(readableError(results[0].reason));
    if (results[1].status === "fulfilled") setServices(pickList<ServiceOffering>(results[1].value));
    if (results[2].status === "fulfilled") setWindows(pickList<AvailabilityWindow>(results[2].value));
    if (results[3].status === "fulfilled") setOrders(pickList<Order>(results[3].value, ["items", "orders"]));
    if (results[4].status === "fulfilled") setToday(results[4].value);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const stats = useMemo(() => {
    const activeServices = services.filter((item) => item.isActive !== false).length;
    const activeWindows = windows.filter(
      (item) => item.isActive && Date.parse(item.endsAt) > now,
    ).length;
    const pending = orders.filter((item) => item.status === "pending" && !item.companionConfirmedAt).length;
    const upcoming = orders.filter((item) => ["paid", "inService"].includes(item.status)).length;
    return { activeServices, activeWindows, pending, upcoming };
  }, [now, orders, services, windows]);

  async function toggleService(service: ServiceOffering) {
    setActing(service.id);
    try {
      await requestApi(`/companions/me/service-offerings/${encodeURIComponent(service.id)}`, {
        method: "PATCH",
        data: { isActive: service.isActive === false },
      });
      await load();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setActing("");
    }
  }

  async function toggleWindow(window: AvailabilityWindow) {
    setActing(window.id);
    try {
      await requestApi(`/companions/me/availability-windows/${encodeURIComponent(window.id)}`, {
        method: "PATCH",
        data: { isActive: !window.isActive },
      });
      await load();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setActing("");
    }
  }

  async function actOnOrder(order: Order, action: "confirm" | "reject" | "start" | "complete") {
    setActing(order.id);
    const endpoint = `/orders/service/${encodeURIComponent(order.id)}/${action}`;
    try {
      await requestApi(endpoint, { method: "POST" });
      setNotice("订单状态已更新。");
      await load();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setActing("");
    }
  }

  if (!user) {
    return (
      <div className="content-page workbench-page">
        <PageHeading eyebrow="双角色账号" title="陪伴者工作台" description="已审核陪伴者可在同一个网站里管理服务与履约。" />
        <AuthWall title="登录后进入工作台" description="工作台仅向当前账号拥有的、已审核陪伴者资料开放。" />
      </div>
    );
  }

  if (user.role !== "companion") {
    return (
      <div className="content-page workbench-page">
        <EmptyState
          title="当前账号没有工作台权限"
          description="首发阶段不开放自助入驻。只有平台已完成实名、服务与合规审核的陪伴者账号可以进入。"
          action={<Link href="/discover" className="button button-primary">返回用户端</Link>}
        />
      </div>
    );
  }

  return (
    <div className="content-page workbench-page">
      <div className="workbench-topbar">
        <PageHeading
          eyebrow="陪伴者工作台"
          title={`晚上好，${profile?.name || user.profile?.displayName || "陪伴者"}`}
          description="服务、时段和订单都在同一个账号里；公开资料与客户权限仍严格分开。"
        />
        <div className="workbench-top-actions">
          <Link href="/discover" className="button button-secondary"><Sparkles size={17} /> 去用户端看看</Link>
          <button className="button button-ghost" onClick={() => void load()}><RefreshCw size={17} /> 刷新</button>
        </div>
      </div>

      {notice && <div className="inline-notice success">{notice}</div>}
      {error && <div className="inline-notice error">{error}</div>}
      {loading ? (
        <LoadingState label="正在整理今天的工作台…" />
      ) : (
        <>
          <section className="workbench-stats">
            <article className="rose"><span><Clock3 size={21} /></span><div><small>待确认预约</small><strong>{stats.pending}</strong><p>需要尽快回应</p></div></article>
            <article className="blue"><span><CalendarClock size={21} /></span><div><small>进行中服务</small><strong>{stats.upcoming}</strong><p>已支付或服务中</p></div></article>
            <article className="green"><span><PackagePlus size={21} /></span><div><small>在售服务</small><strong>{stats.activeServices}</strong><p>客户当前可见</p></div></article>
            <article className="amber"><span><Coins size={21} /></span><div><small>未来可约时段</small><strong>{stats.activeWindows}</strong><p>仍启用且未过期</p></div></article>
          </section>

          <div className="workbench-grid">
            <section className="dashboard-card span-two">
              <div className="dashboard-card-heading">
                <div><span className="heading-icon"><BriefcaseBusiness size={19} /></span><div><h2>预约与履约</h2><p>确认、拒绝、开始与完成均由服务端重新校验。</p></div></div>
                <span className="private-label">仅本人</span>
              </div>
              {orders.length ? (
                <div className="service-order-list">
                  {orders.slice(0, 8).map((order) => {
                    const status = ORDER_STATUS[order.status] || { label: order.status, tone: "muted" };
                    return (
                      <article key={order.id}>
                        <span className="service-order-avatar">{order.customer?.initials || "客户"}</span>
                        <div className="service-order-main">
                          <div><strong>{order.customer?.name || "客户"} · {orderTitle(order)}</strong><StatusBadge label={status.label} tone={status.tone} /></div>
                          <p>{dateTime(order.scheduledAt)} · {order.durationMinutes} 分钟 · {currency(order.amountCents)}</p>
                        </div>
                        <div className="service-order-actions">
                          {order.status === "pending" && !order.companionConfirmedAt && (
                            <>
                              <button className="button button-primary button-small" disabled={acting === order.id} onClick={() => void actOnOrder(order, "confirm")}>确认</button>
                              <button className="button button-ghost button-small" disabled={acting === order.id} onClick={() => void actOnOrder(order, "reject")}>拒绝</button>
                            </>
                          )}
                          {order.status === "paid" && (
                            <button className="button button-primary button-small" disabled={acting === order.id} onClick={() => void actOnOrder(order, "start")}>开始服务</button>
                          )}
                          {order.status === "inService" && (
                            <button className="button button-primary button-small" disabled={acting === order.id} onClick={() => void actOnOrder(order, "complete")}>完成服务</button>
                          )}
                          {order.conversationId && <Link className="icon-button" href={`/messages?conversation=${encodeURIComponent(order.conversationId)}`}><MessageCircleMore size={18} /></Link>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="inline-empty">暂时没有服务订单。</p>
              )}
            </section>

            <section className="dashboard-card today-card">
              <div className="dashboard-card-heading">
                <div><span className="heading-icon"><CalendarClock size={19} /></span><div><h2>今日安排</h2><p>北京时间</p></div></div>
              </div>
              {today?.items?.length ? (
                <div className="today-list">
                  {today.items.map((item) => (
                    <div key={item.id}>
                      <time>{dateTime(item.scheduledAt, { hour: "2-digit", minute: "2-digit" }).split(" ").pop()}</time>
                      <span><strong>{item.serviceTitle}</strong><small>{item.durationMinutes} 分钟</small></span>
                      <StatusBadge label={ORDER_STATUS[item.status]?.label || item.status} tone={ORDER_STATUS[item.status]?.tone || "muted"} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="inline-empty">今天没有已安排服务。</p>
              )}
            </section>

            <section className="dashboard-card">
              <div className="dashboard-card-heading">
                <div><span className="heading-icon"><PackagePlus size={19} /></span><div><h2>服务商品</h2><p>公开价格与交付方式</p></div></div>
                <button className="round-add" onClick={() => setServiceModal(true)} aria-label="新增服务"><Plus size={18} /></button>
              </div>
              <div className="workbench-item-list">
                {services.map((service) => (
                  <article key={service.id}>
                    <span>{service.deliveryMode === "voice" ? <Volume2 size={18} /> : <MessageCircleMore size={18} />}</span>
                    <div><strong>{service.title}</strong><small>{service.durationMinutes} 分钟 · {currency(service.priceCents)}</small></div>
                    <button
                      className={service.isActive === false ? "state-button off" : "state-button"}
                      disabled={acting === service.id}
                      onClick={() => void toggleService(service)}
                    >
                      {service.isActive === false ? <><PlayCircle size={15} />启用</> : <><PauseCircle size={15} />在售</>}
                    </button>
                  </article>
                ))}
                {!services.length && <p className="inline-empty">还没有服务商品。</p>}
              </div>
            </section>

            <section className="dashboard-card">
              <div className="dashboard-card-heading">
                <div><span className="heading-icon"><CalendarClock size={19} /></span><div><h2>可约时间</h2><p>客户只看到仍有余量的候选</p></div></div>
                <button className="round-add" onClick={() => setAvailabilityModal(true)} aria-label="新增时段"><Plus size={18} /></button>
              </div>
              <div className="workbench-item-list">
                {windows
                  .filter((window) => Date.parse(window.endsAt) > now)
                  .slice(0, 6)
                  .map((window) => (
                    <article key={window.id}>
                      <span><Clock3 size={18} /></span>
                      <div><strong>{dateTime(window.startsAt)}</strong><small>至 {dateTime(window.endsAt)} · 容量 {window.capacity}</small></div>
                      <button
                        className={window.isActive ? "state-button" : "state-button off"}
                        disabled={acting === window.id}
                        onClick={() => void toggleWindow(window)}
                      >
                        {window.isActive ? "已启用" : "已暂停"}
                      </button>
                    </article>
                  ))}
                {!windows.length && <p className="inline-empty">还没有可约时间。</p>}
              </div>
            </section>
          </div>
        </>
      )}

      {serviceModal && (
        <ServiceModal
          onClose={() => setServiceModal(false)}
          onCreated={async () => {
            setServiceModal(false);
            setNotice("服务商品已创建。");
            await load();
          }}
          onError={setError}
        />
      )}
      {availabilityModal && (
        <AvailabilityModal
          onClose={() => setAvailabilityModal(false)}
          onCreated={async () => {
            setAvailabilityModal(false);
            setNotice("可约时间已创建。");
            await load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function ServiceModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"text" | "voice">("text");
  const [duration, setDuration] = useState("30");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await requestApi("/companions/me/service-offerings", {
        method: "POST",
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          deliveryMode,
          durationMinutes: Number(duration),
          priceCents: Math.round(Number(price) * 100),
          topicIds: [],
          isActive: true,
        },
      });
      await onCreated();
    } catch (reason) {
      onError(readableError(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal-card wide" role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        <p className="eyebrow">服务商品</p>
        <h2>新增一项服务</h2>
        <p>创建后会进入你的私有商品列表；启用且资料通过审核后才可能公开展示。</p>
        <form onSubmit={submit} className="modal-form-grid">
          <label className="field full"><span>服务名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：安静文字陪伴" /></label>
          <label className="field full"><span>服务说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} /></label>
          <label className="field"><span>服务方式</span><select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "text" | "voice")}><option value="text">文字</option><option value="voice">语音</option></select></label>
          <label className="field"><span>时长（分钟）</span><input type="number" min={30} max={240} step={15} value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
          <label className="field full"><span>单次价格（元）</span><input type="number" min={1} max={20000} step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="39" /></label>
          <button className="button button-primary button-full full" disabled={saving || !title.trim() || Number(price) < 1}>{saving ? "创建中…" : "创建服务"}</button>
        </form>
      </section>
    </div>
  );
}

function AvailabilityModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await requestApi("/companions/me/availability-windows", {
        method: "POST",
        data: {
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          capacity: Number(capacity),
          isActive: true,
        },
      });
      await onCreated();
    } catch (reason) {
      onError(readableError(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal-card" role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        <p className="eyebrow">可约时间</p>
        <h2>新增一个服务窗口</h2>
        <p>客户只会看到仍公开、有对应服务商品且未满额的候选时段。</p>
        <form onSubmit={submit}>
          <label className="field"><span>开始时间</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
          <label className="field"><span>结束时间</span><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
          <label className="field"><span>容量</span><input type="number" min={1} max={20} value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label>
          <button className="button button-primary button-full" disabled={saving || !startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)}>
            {saving ? "创建中…" : "创建并启用"}
          </button>
        </form>
      </section>
    </div>
  );
}
