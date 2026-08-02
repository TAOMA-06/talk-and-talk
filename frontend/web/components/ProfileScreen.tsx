"use client";

import {
  ArrowRight,
  Bell,
  Bookmark,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Clock3,
  LogOut,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { PRIVACY_URL, TERMS_URL, requestApi } from "../lib/api-client";
import { dateTime, initials, pickList, readableError } from "../lib/format";
import type { AuthUser, Companion, Notification } from "../lib/types";
import { useSession } from "./AppShell";
import { AuthWall, LoadingState, PageHeading } from "./ui";

type RecommendationTopic = { id: string; name: string };
type RecommendationPreferences = {
  personalizationEnabled: boolean;
  topicIds: string[];
  city: string | null;
  maxPricePerHalfHour: number | null;
  preferredTimeSlots: string[];
};

export default function ProfileScreen() {
  const { user, refresh, signOut } = useSession();
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [favorites, setFavorites] = useState<Companion[]>([]);
  const [recent, setRecent] = useState<Companion[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [topics, setTopics] = useState<RecommendationTopic[]>([]);
  const [preferences, setPreferences] = useState<RecommendationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      requestApi<AuthUser>("/me"),
      requestApi<{ items: Companion[] }>("/favorites/companions"),
      requestApi<{ items: Companion[] }>("/recently-viewed/companions"),
      requestApi<{ items: Notification[] }>("/notifications"),
      requestApi<{ items: RecommendationTopic[] }>("/recommendations/topics"),
      requestApi<RecommendationPreferences>("/recommendations/me/preferences"),
    ]);

    const me = results[0];
    if (me.status === "fulfilled") {
      setProfile(me.value);
      setDisplayName(me.value.profile?.displayName || "");
      setGender(me.value.profile?.gender || "");
      setAge(me.value.profile?.age ? String(me.value.profile.age) : "");
    } else {
      setError(readableError(me.reason));
    }
    if (results[1].status === "fulfilled") setFavorites(pickList<Companion>(results[1].value));
    if (results[2].status === "fulfilled") setRecent(pickList<Companion>(results[2].value));
    if (results[3].status === "fulfilled") setNotifications(pickList<Notification>(results[3].value));
    if (results[4].status === "fulfilled") setTopics(pickList<RecommendationTopic>(results[4].value));
    if (results[5].status === "fulfilled") setPreferences(results[5].value);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const updated = await requestApi<AuthUser>("/me", {
        method: "PATCH",
        data: {
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          ...(gender ? { gender } : {}),
          ...(age ? { age: Number(age) } : {}),
        },
      });
      setProfile(updated);
      setNotice("个人资料已保存，公开昵称已通过服务端审核。");
      await refresh();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setSaving(false);
    }
  }

  async function togglePreference(topicId?: string) {
    if (!preferences) return;
    const next = topicId
      ? {
          ...preferences,
          topicIds: preferences.topicIds.includes(topicId)
            ? preferences.topicIds.filter((id) => id !== topicId)
            : [...preferences.topicIds, topicId],
        }
      : { ...preferences, personalizationEnabled: !preferences.personalizationEnabled };
    setPreferences(next);
    try {
      const updated = await requestApi<RecommendationPreferences>("/recommendations/me/preferences", {
        method: "PATCH",
        data: {
          personalizationEnabled: next.personalizationEnabled,
          topicIds: next.topicIds,
        },
      });
      setPreferences(updated);
    } catch (reason) {
      setPreferences(preferences);
      setError(readableError(reason));
    }
  }

  async function removeFavorite(id: string) {
    try {
      await requestApi(`/favorites/companions/${encodeURIComponent(id)}`, { method: "DELETE" });
      setFavorites((items) => items.filter((item) => item.id !== id));
    } catch (reason) {
      setError(readableError(reason));
    }
  }

  async function markAllRead() {
    try {
      await requestApi("/notifications/read-all", { method: "POST" });
      setNotifications((items) =>
        items.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })),
      );
    } catch (reason) {
      setError(readableError(reason));
    }
  }

  async function withdrawConsent() {
    if (!window.confirm("撤回同意后会立即退出账号。确定继续吗？")) return;
    try {
      await requestApi("/users/me/legal-consents/current", { method: "DELETE" });
    } finally {
      await signOut(true);
    }
  }

  async function requestDeletion() {
    if (!window.confirm("注销申请会进入人工处理流程。确定提交吗？")) return;
    try {
      const result = await requestApi<{ message: string }>("/me/deletion-request", { method: "POST" });
      setNotice(result.message || "注销申请已收讫。");
    } catch (reason) {
      setError(readableError(reason));
    }
  }

  if (!user) {
    return (
      <div className="content-page profile-page">
        <PageHeading eyebrow="我的空间" title="账号、偏好与安全设置" description="你的资料、收藏、通知和工作台集中在这里。" />
        <AuthWall title="登录后进入个人空间" description="个人资料、书签、最近浏览和通知只对你可见。" />
      </div>
    );
  }

  const me = profile || user;
  const isCompanion = me.role === "companion";
  const unread = notifications.filter((item) => !item.readAt).length;

  return (
    <div className="content-page profile-page">
      <PageHeading
        eyebrow="我的空间"
        title={`你好，${me.profile?.displayName || (isCompanion ? "陪伴者" : "朋友")}`}
        description={isCompanion ? "你可以在同一个账号里寻找陪伴，也可以管理自己的服务。" : "管理资料、偏好和只属于你的记录。"}
      />

      {notice && <div className="inline-notice success">{notice}</div>}
      {error && <div className="inline-notice error">{error}</div>}
      {loading ? (
        <LoadingState label="正在整理你的个人空间…" />
      ) : (
        <div className="profile-layout">
          <div className="profile-main-column">
            <section className="settings-card identity-card">
              <div className="identity-summary">
                <span className="identity-avatar">{initials(me.profile?.displayName)}</span>
                <div>
                  <div className="name-line">
                    <h2>{me.profile?.displayName || "未设置昵称"}</h2>
                    {me.profile?.isVerified && <span className="verified-label"><Check size={14} /> 已核验</span>}
                  </div>
                  <p>{isCompanion ? "普通用户 · 陪伴者" : "普通用户"} · {me.profile?.phone || "已登录手机号"}</p>
                </div>
              </div>
              <form onSubmit={saveProfile} className="profile-form">
                <label className="field">
                  <span>显示名称</span>
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={30} placeholder="你的昵称" />
                </label>
                <label className="field">
                  <span>性别</span>
                  <select value={gender} onChange={(event) => setGender(event.target.value)}>
                    <option value="">暂不填写</option>
                    <option value="female">女</option>
                    <option value="male">男</option>
                  </select>
                </label>
                <label className="field">
                  <span>年龄</span>
                  <input type="number" min={18} max={120} value={age} onChange={(event) => setAge(event.target.value)} placeholder="18+" />
                </label>
                <button className="button button-primary button-compact" disabled={saving}>
                  {saving ? "保存中…" : "保存资料"}
                </button>
              </form>
            </section>

            {isCompanion ? (
              <Link href="/workbench" className="workbench-entry-card">
                <span className="workbench-entry-icon"><BriefcaseBusiness size={25} /></span>
                <div>
                  <p className="eyebrow">双角色账号</p>
                  <h2>进入陪伴者工作台</h2>
                  <p>管理服务商品、可约时段、待确认预约与履约进度。</p>
                </div>
                <ArrowRight size={22} />
              </Link>
            ) : (
              <section className="settings-card closed-entry">
                <span><ShieldCheck size={22} /></span>
                <div>
                  <h3>陪伴者入驻暂未开放</h3>
                  <p>当前仅向平台已完成实名、服务与合规审核的预配置陪伴者开放工作台。</p>
                </div>
              </section>
            )}

            <section className="settings-card">
              <div className="settings-card-heading">
                <div><span className="heading-icon"><Sparkles size={19} /></span><div><h2>个性化推荐</h2><p>只使用主动偏好、公开卡片互动和订单主题，不读取聊天内容。</p></div></div>
                {preferences && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={preferences.personalizationEnabled}
                    className={preferences.personalizationEnabled ? "switch on" : "switch"}
                    onClick={() => void togglePreference()}
                  >
                    <span />
                  </button>
                )}
              </div>
              {preferences?.personalizationEnabled && (
                <div className="preference-topics">
                  <span>感兴趣的主题</span>
                  <div className="chip-row">
                    {topics.map((topic) => (
                      <button
                        type="button"
                        key={topic.id}
                        className={preferences.topicIds.includes(topic.id) ? "filter-chip selected" : "filter-chip"}
                        onClick={() => void togglePreference(topic.id)}
                      >
                        {preferences.topicIds.includes(topic.id) && <Check size={14} />}
                        {topic.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!preferences && <p className="inline-empty">推荐设置暂时不可用，不影响按公开条件查找。</p>}
            </section>

            <section className="settings-card">
              <div className="settings-card-heading">
                <div><span className="heading-icon"><Bookmark size={19} /></span><div><h2>我的书签</h2><p>仅你可见，不代表当前在售或有可约时段。</p></div></div>
                <span className="private-label">私人</span>
              </div>
              {favorites.length ? (
                <div className="private-list">
                  {favorites.map((companion) => (
                    <div key={companion.id} className="private-row">
                      <Link href={`/companions/${encodeURIComponent(companion.id)}`}>
                        <span className="mini-avatar">{companion.initials}</span>
                        <span><strong>{companion.name}</strong><small>{companion.role}</small></span>
                      </Link>
                      <button onClick={() => void removeFavorite(companion.id)} aria-label={`移除 ${companion.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="inline-empty">还没有保存的陪伴者。在资料页点击书签即可加入。</p>
              )}
            </section>

            <section className="settings-card">
              <div className="settings-card-heading">
                <div><span className="heading-icon"><Clock3 size={19} /></span><div><h2>最近浏览</h2><p>最多保留 20 条，不用于推荐，也不会提示陪伴者。</p></div></div>
                <span className="private-label">私人</span>
              </div>
              {recent.length ? (
                <div className="recent-grid">
                  {recent.slice(0, 6).map((companion) => (
                    <Link href={`/companions/${encodeURIComponent(companion.id)}`} key={companion.id}>
                      <span className="mini-avatar">{companion.initials}</span>
                      <strong>{companion.name}</strong>
                      <ChevronRight size={15} />
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="inline-empty">打开过的真实公开资料会出现在这里。</p>
              )}
            </section>
          </div>

          <aside className="profile-side-column">
            <section className="settings-card notification-card">
              <div className="settings-card-heading">
                <div><span className="heading-icon"><Bell size={19} /></span><div><h2>通知</h2><p>{unread ? `${unread} 条未读` : "暂无未读"}</p></div></div>
                {unread > 0 && <button className="text-button" onClick={() => void markAllRead()}>全部已读</button>}
              </div>
              {notifications.length ? (
                <div className="notification-list">
                  {notifications.slice(0, 6).map((item) => (
                    <article key={item.id} className={!item.readAt ? "unread" : ""}>
                      <span />
                      <div><strong>{item.title}</strong><p>{item.body}</p><small>{dateTime(item.createdAt)}</small></div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="inline-empty">暂无通知。</p>
              )}
            </section>

            <section className="settings-card account-menu">
              <h2><Settings2 size={19} /> 账号与规则</h2>
              <Link href="/safety"><ShieldCheck size={17} /><span>安全与支持</span><ChevronRight size={16} /></Link>
              <a href={TERMS_URL} target="_blank" rel="noreferrer"><UserRound size={17} /><span>用户协议</span><ChevronRight size={16} /></a>
              <a href={PRIVACY_URL} target="_blank" rel="noreferrer"><ShieldCheck size={17} /><span>隐私政策</span><ChevronRight size={16} /></a>
              <button onClick={() => void signOut()}><LogOut size={17} /><span>退出当前账号</span><ChevronRight size={16} /></button>
              <button className="danger" onClick={requestDeletion}><Trash2 size={17} /><span>申请注销账号</span><ChevronRight size={16} /></button>
              <button className="danger" onClick={withdrawConsent}><Trash2 size={17} /><span>撤回协议同意并退出</span><ChevronRight size={16} /></button>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
