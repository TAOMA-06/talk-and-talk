"use client";

import {
  ArrowLeft,
  BellOff,
  CircleSlash2,
  MessageCircle,
  MoreHorizontal,
  Send,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { requestApi } from "../lib/api-client";
import { dateTime, pickList, readableError, relativeTime } from "../lib/format";
import type { ChatMessage, Conversation } from "../lib/types";
import { useSession } from "./AppShell";
import { AuthWall, EmptyState, LoadingState, PageHeading } from "./ui";

export default function MessagesScreen() {
  const { user } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) || null,
    [conversations, selectedId],
  );

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const result = await requestApi<{ conversations: Conversation[] }>("/conversations");
      const items = pickList<Conversation>(result, ["conversations", "items"]);
      setConversations(items);
      const requested = new URLSearchParams(window.location.search).get("conversation");
      setSelectedId((current) => current || (requested && items.some((item) => item.id === requested) ? requested : items[0]?.id || ""));
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId || !user) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setMessagesLoading(true);
      void requestApi<{ messages: ChatMessage[] }>(
        `/conversations/${encodeURIComponent(selectedId)}/messages?limit=50`,
      )
        .then((result) => {
          if (active) setMessages(pickList<ChatMessage>(result, ["messages", "items"]));
        })
        .catch((reason) => {
          if (active) setError(readableError(reason));
        })
        .finally(() => {
          if (active) setMessagesLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selectedId, user]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    setSending(true);
    setError("");
    try {
      const result = await requestApi<{
        message: ChatMessage | null;
        safetyMessage: ChatMessage | null;
        moderation: { decision: string; deliveryStatus: string };
      }>(`/conversations/${encodeURIComponent(selected.id)}/messages`, {
        method: "POST",
        data: { content: draft.trim() },
      });
      setDraft("");
      setMessages((items) => [
        ...items,
        ...(result.message ? [result.message] : []),
        ...(result.safetyMessage ? [result.safetyMessage] : []),
      ]);
      if (result.moderation.decision === "block") {
        setError("这条消息未发送。请根据安全提示修改内容。");
      }
      await loadConversations();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setSending(false);
    }
  }

  async function updateConversation(kind: "mute" | "block") {
    if (!selected) return;
    setError("");
    try {
      const path =
        kind === "mute"
          ? `/conversations/${encodeURIComponent(selected.id)}/notification-preference`
          : `/conversations/${encodeURIComponent(selected.id)}/block`;
      const data =
        kind === "mute"
          ? { muted: !selected.messageNotificationsMuted }
          : { blocked: !selected.conversationBlockedByYou };
      await requestApi(path, { method: "PUT", data });
      setMenuOpen(false);
      await loadConversations();
    } catch (reason) {
      setError(readableError(reason));
    }
  }

  if (!user) {
    return (
      <div className="content-page messages-page">
        <PageHeading
          eyebrow="平台内沟通"
          title="消息只属于会话双方"
          description="支付订单后，会话会在这里出现。"
        />
        <AuthWall title="登录后查看消息" description="聊天内容、未读状态与安全设置只对会话参与者可见。" />
      </div>
    );
  }

  return (
    <div className="content-page messages-page">
      <PageHeading
        eyebrow="平台内沟通"
        title="消息"
        description="请勿交换私人联系方式、线下见面或私下转账。"
      />
      <div className="message-safety-bar">
        <ShieldCheck size={18} />
        <span>可举报 · 可静音 · 可停止互动 · 内容可能经过安全审核</span>
      </div>
      {error && <div className="inline-notice error">{error}</div>}

      <div className={selected ? "messenger-layout has-selection" : "messenger-layout"}>
        <aside className="conversation-list">
          <header><h2>会话</h2><span>{conversations.length}</span></header>
          {loading ? (
            <LoadingState />
          ) : conversations.length ? (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={selectedId === conversation.id ? "conversation-row active" : "conversation-row"}
                onClick={() => setSelectedId(conversation.id)}
              >
                <span className="conversation-avatar">
                  {conversation.participant.initials || conversation.participant.name.slice(0, 2)}
                  {conversation.participant.isOnline && <i />}
                </span>
                <span className="conversation-copy">
                  <span><strong>{conversation.participant.name}</strong><small>{relativeTime(conversation.updatedAt)}</small></span>
                  <em>
                    {conversation.conversationBlockedByYou
                      ? "已停止互动"
                      : conversation.lastMessage?.content || "暂无消息"}
                  </em>
                </span>
                {conversation.unreadCount > 0 && <b>{Math.min(conversation.unreadCount, 99)}</b>}
              </button>
            ))
          ) : (
            <div className="conversation-empty">
              <MessageCircle size={28} />
              <p>支付订单后，会话会出现在这里。</p>
            </div>
          )}
        </aside>

        <section className="chat-panel">
          {selected ? (
            <>
              <header className="chat-header">
                <button className="mobile-back" onClick={() => setSelectedId("")} aria-label="返回会话列表">
                  <ArrowLeft size={20} />
                </button>
                <span className="conversation-avatar small">{selected.participant.initials}</span>
                <div>
                  <strong>{selected.participant.name}</strong>
                  <small>{selected.messageInteractionAvailable ? "当前可沟通" : "当前只读"}</small>
                </div>
                <div className="chat-menu-wrap">
                  <button
                    className="icon-button"
                    aria-label="会话设置"
                    onClick={() => setMenuOpen((value) => !value)}
                  >
                    <MoreHorizontal size={20} />
                  </button>
                  {menuOpen && (
                    <div className="chat-menu">
                      <button onClick={() => void updateConversation("mute")}>
                        {selected.messageNotificationsMuted ? <Volume2 size={16} /> : <BellOff size={16} />}
                        {selected.messageNotificationsMuted ? "恢复消息提醒" : "静音消息提醒"}
                      </button>
                      <button className="danger" onClick={() => void updateConversation("block")}>
                        <CircleSlash2 size={16} />
                        {selected.conversationBlockedByYou ? "恢复互动" : "停止互动"}
                      </button>
                    </div>
                  )}
                </div>
              </header>

              <div className="message-thread">
                {messagesLoading ? (
                  <LoadingState label="正在读取消息…" />
                ) : messages.length ? (
                  messages.map((message) => {
                    const mine = message.senderId === user.id;
                    const system = ["system", "safety"].includes(message.type);
                    return (
                      <div
                        key={message.id}
                        className={system ? "message system" : mine ? "message mine" : "message theirs"}
                      >
                        <div>
                          <p>{message.content}</p>
                          <small>
                            {dateTime(message.timestamp, { hour: "2-digit", minute: "2-digit" })}
                            {message.moderationStatus === "pendingReview" ? " · 审核中" : ""}
                          </small>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="thread-empty">
                    <MessageCircle size={28} />
                    <p>从一句简单的问候开始。</p>
                  </div>
                )}
              </div>

              <form className="message-composer" onSubmit={sendMessage}>
                {!selected.messageInteractionAvailable && (
                  <div className="composer-disabled">
                    {selected.conversationBlockedByYou ? "你已停止这段互动，可在会话设置中恢复。" : "当前服务不在可沟通时段内。"}
                  </div>
                )}
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="写下你想说的话…"
                  maxLength={2000}
                  rows={2}
                  disabled={!selected.messageInteractionAvailable || selected.conversationBlockedByYou}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div>
                  <small>{draft.length} / 2000 · Enter 发送，Shift + Enter 换行</small>
                  <button
                    className="button button-primary button-compact"
                    disabled={sending || !draft.trim() || !selected.messageInteractionAvailable}
                  >
                    {sending ? "发送中…" : "发送"} <Send size={15} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <EmptyState
              title="选择一个会话"
              description="消息与安全设置会在这里显示。"
            />
          )}
        </section>
      </div>
    </div>
  );
}
