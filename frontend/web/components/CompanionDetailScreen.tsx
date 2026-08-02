"use client";

import {
  ArrowLeft,
  BadgeCheck,
  Bookmark,
  CalendarDays,
  Check,
  Clock3,
  HeartHandshake,
  MessageCircleMore,
  ShieldCheck,
  Star,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { requestApi } from "../lib/api-client";
import { previewCompanions, previewOfferings } from "../lib/fixtures";
import {
  availabilityLabel,
  currency,
  dateTime,
  pickList,
  readableError,
} from "../lib/format";
import type {
  AvailabilityCandidate,
  AvailabilityResponse,
  Companion,
  Order,
  ServiceOffering,
} from "../lib/types";
import { useSession } from "./AppShell";
import { EmptyState, LoadingState, StatusBadge } from "./ui";

function previewAvailability(offering: ServiceOffering): AvailabilityResponse {
  const base = Date.now() + 3 * 3_600_000;
  return {
    source: "structured",
    timezone: "Asia/Shanghai",
    serviceOfferingId: offering.id,
    durationMinutes: offering.durationMinutes,
    legacyAvailableTimes: [],
    items: [0, 1, 2, 3].map((index) => {
      const startsAt = new Date(base + index * 19 * 3_600_000);
      const endsAt = new Date(startsAt.getTime() + offering.durationMinutes * 60_000);
      return {
        id: `${offering.id}-slot-${index}`,
        availabilityWindowId: `${offering.id}-window-${index}`,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        capacity: 2,
        reservedCount: index % 2,
        availableCapacity: index % 2 ? 1 : 2,
      };
    }),
  };
}

export default function CompanionDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useSession();
  const [companion, setCompanion] = useState<Companion | null>(null);
  const [offerings, setOfferings] = useState<ServiceOffering[]>([]);
  const [availability, setAvailability] = useState<AvailabilityCandidate[]>([]);
  const [selectedOfferingId, setSelectedOfferingId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [loading, setLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(id.startsWith("preview-"));
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const previewCompanion = previewCompanions.find((item) => item.id === id);
      if (previewCompanion) {
        setCompanion(previewCompanion);
        const items = previewOfferings[id] || [];
        setOfferings(items);
        setSelectedOfferingId(items[0]?.id || "");
        setLoading(false);
        return;
      }

      void Promise.all([
        requestApi<Companion>(`/companions/${encodeURIComponent(id)}`),
        requestApi<{ items: ServiceOffering[] }>(`/companions/${encodeURIComponent(id)}/service-offerings`),
      ])
        .then(([profile, catalog]) => {
          if (!active) return;
          const items = pickList<ServiceOffering>(catalog);
          setCompanion(profile);
          setOfferings(items);
          setSelectedOfferingId(items[0]?.id || "");
          setPreview(false);
          if (user) {
            void requestApi(`/recently-viewed/companions/${encodeURIComponent(id)}`, {
              method: "PUT",
            }).catch(() => undefined);
          }
        })
        .catch((reason) => {
          if (!active) return;
          setError(readableError(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [id, user]);

  const selectedOffering = useMemo(
    () => offerings.find((item) => item.id === selectedOfferingId) || null,
    [offerings, selectedOfferingId],
  );
  const selectedSlot = useMemo(
    () => availability.find((item) => item.id === selectedSlotId) || null,
    [availability, selectedSlotId],
  );

  const loadAvailability = useCallback(async () => {
    if (!selectedOffering) {
      setAvailability([]);
      return;
    }
    setSelectedSlotId("");
    if (preview) {
      setAvailability(previewAvailability(selectedOffering).items);
      return;
    }
    setAvailabilityLoading(true);
    setBookingError("");
    try {
      const query = new URLSearchParams({
        serviceOfferingId: selectedOffering.id,
        durationMinutes: String(selectedOffering.durationMinutes),
        days: "7",
      });
      const result = await requestApi<AvailabilityResponse>(
        `/companions/${encodeURIComponent(id)}/availability?${query.toString()}`,
      );
      setAvailability(result.items || []);
    } catch (reason) {
      setAvailability([]);
      setBookingError(readableError(reason));
    } finally {
      setAvailabilityLoading(false);
    }
  }, [id, preview, selectedOffering]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAvailability(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAvailability]);

  async function saveFavorite() {
    if (!user) {
      router.push("/login");
      return;
    }
    if (preview) {
      setBookingError("预览资料不能保存；真实服务连接恢复后即可使用书签。");
      return;
    }
    try {
      if (saved) {
        await requestApi(`/favorites/companions/${encodeURIComponent(id)}`, { method: "DELETE" });
        setSaved(false);
      } else {
        await requestApi(`/favorites/companions/${encodeURIComponent(id)}`, { method: "PUT" });
        setSaved(true);
      }
    } catch (reason) {
      setBookingError(readableError(reason));
    }
  }

  async function createOrder() {
    if (!user) {
      router.push("/login");
      return;
    }
    if (preview) {
      setBookingError("这是连接中使用的预览资料，不能创建真实订单。");
      return;
    }
    if (!selectedOffering || !selectedSlot) {
      setBookingError("请先选择服务和可约时间");
      return;
    }

    setBooking(true);
    setBookingError("");
    try {
      const requestId = `web_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const order = await requestApi<Order>("/orders", {
        method: "POST",
        data: {
          companionId: id,
          serviceOfferingId: selectedOffering.id,
          availabilityWindowId: selectedSlot.availabilityWindowId,
          themeId: selectedOffering.topicIds[0] || "general",
          durationMinutes: selectedOffering.durationMinutes,
          scheduledAt: selectedSlot.startsAt,
          clientRequestId: requestId,
        },
      });
      router.push(`/orders?created=${encodeURIComponent(order.id)}`);
    } catch (reason) {
      setBookingError(readableError(reason));
    } finally {
      setBooking(false);
    }
  }

  if (loading) return <div className="content-page"><LoadingState label="正在读取陪伴者资料…" /></div>;
  if (!companion) {
    return (
      <div className="content-page">
        <EmptyState
          title="没有找到这份资料"
          description={error || "资料可能已暂停公开，请返回发现页查看其他陪伴者。"}
          action={<Link className="button button-secondary" href="/discover">返回发现</Link>}
        />
      </div>
    );
  }

  return (
    <div className="content-page detail-page">
      <Link href="/discover" className="back-link"><ArrowLeft size={17} /> 返回发现</Link>
      {preview && (
        <div className="preview-notice compact">
          <span className="preview-dot" />
          <div><strong>预览资料</strong><span>用于服务连接不可用时展示网站效果，不能创建真实订单。</span></div>
        </div>
      )}

      <div className="detail-layout">
        <section className="profile-panel">
          <div className="profile-cover">
            <div className="profile-avatar">{companion.initials || companion.name.slice(0, 2)}</div>
            <div className="profile-state">
              <span className={companion.isOnline ? "online-dot" : "offline-dot"} />
              {companion.isOnline ? "现在在线" : availabilityLabel(companion.availability)}
            </div>
          </div>
          <div className="profile-content">
            <div className="profile-title-row">
              <div>
                <div className="name-line large">
                  <h1>{companion.name}</h1>
                  {companion.isVerified && <span className="verified-label"><BadgeCheck size={16} /> 已认证</span>}
                </div>
                <p>{companion.role}</p>
              </div>
              <button
                type="button"
                className={saved ? "icon-button saved" : "icon-button"}
                onClick={saveFavorite}
                aria-label={saved ? "取消保存" : "保存陪伴者"}
              >
                <Bookmark size={20} fill={saved ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="profile-rating">
              <span><Star size={17} fill="currentColor" /> {companion.rating.toFixed(1)}</span>
              <span>{companion.reviewCount} 条评价</span>
              <span>{companion.cityDistrict || "纯线上服务"}</span>
            </div>
            <p className="profile-bio">{companion.bio}</p>
            <div className="tag-row large">
              {(companion.tags || companion.specialties || []).map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </div>

          <div className="profile-principles">
            <article><ShieldCheck size={21} /><div><strong>身份与资料核验</strong><p>“已认证”仅表示平台展示核验，不替代医疗或专业资质。</p></div></article>
            <article><MessageCircleMore size={21} /><div><strong>只在平台内沟通</strong><p>不交换私人联系方式，不私下转账，不安排线下见面。</p></div></article>
            <article><HeartHandshake size={21} /><div><strong>不做治疗承诺</strong><p>线上陪伴不是心理治疗或紧急救援服务。</p></div></article>
          </div>
        </section>

        <aside className="booking-panel">
          <div className="booking-heading">
            <div>
              <p className="eyebrow">预约服务</p>
              <h2>选择此刻需要的陪伴</h2>
            </div>
            <StatusBadge label="平台担保" tone="green" />
          </div>

          <div className="booking-section">
            <h3>1. 选择服务</h3>
            <div className="offering-list">
              {offerings.map((offering) => (
                <button
                  type="button"
                  key={offering.id}
                  className={selectedOfferingId === offering.id ? "offering-card selected" : "offering-card"}
                  onClick={() => setSelectedOfferingId(offering.id)}
                >
                  <span className="offering-icon">
                    {offering.deliveryMode === "voice" ? <Volume2 size={19} /> : <MessageCircleMore size={19} />}
                  </span>
                  <span className="offering-main">
                    <strong>{offering.title}</strong>
                    <small>{offering.description || `${offering.durationMinutes} 分钟平台内服务`}</small>
                    <em>{offering.durationMinutes} 分钟 · {offering.deliveryMode === "voice" ? "实时语音" : "文字交流"}</em>
                  </span>
                  <span className="offering-price">{currency(offering.priceCents)}</span>
                  {selectedOfferingId === offering.id && <Check className="offering-check" size={16} />}
                </button>
              ))}
              {!offerings.length && <p className="inline-empty">当前暂时没有上架服务。</p>}
            </div>
          </div>

          <div className="booking-section">
            <div className="booking-section-title">
              <h3>2. 选择可约时间</h3>
              <span>北京时间</span>
            </div>
            {availabilityLoading ? (
              <LoadingState label="正在核对真实余量…" />
            ) : availability.length ? (
              <div className="slot-grid">
                {availability.map((slot) => (
                  <button
                    type="button"
                    key={slot.id}
                    className={selectedSlotId === slot.id ? "slot-card selected" : "slot-card"}
                    onClick={() => setSelectedSlotId(slot.id)}
                  >
                    <CalendarDays size={16} />
                    <strong>{dateTime(slot.startsAt, { weekday: "short", month: "numeric", day: "numeric" })}</strong>
                    <span><Clock3 size={14} /> {dateTime(slot.startsAt, { hour: "2-digit", minute: "2-digit" }).split(" ").pop()}</span>
                    <small>余 {slot.availableCapacity} 位</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="inline-empty">未来 7 天暂时没有可预约时段。</p>
            )}
          </div>

          {selectedOffering && (
            <div className="booking-summary">
              <span>{selectedOffering.title}</span>
              <strong>{currency(selectedOffering.priceCents)}</strong>
              <small>{selectedSlot ? dateTime(selectedSlot.startsAt) : "请选择时间"} · 实际价格与容量将在创建订单时再次确认</small>
            </div>
          )}
          {bookingError && <p className="form-message error">{bookingError}</p>}
          <button
            type="button"
            className="button button-primary button-full"
            disabled={booking || !selectedOffering || !selectedSlot}
            onClick={createOrder}
          >
            {booking ? "正在创建预约…" : user ? "确认预约" : "登录后预约"}
          </button>
          <p className="fine-print center">
            创建订单不等于支付成功。支付状态只以平台收到的服务端回调为准。
          </p>
        </aside>
      </div>
    </div>
  );
}
