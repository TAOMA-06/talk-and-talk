"use client";

import {
  ArrowRight,
  Flag,
  Heart,
  MessageSquareQuote,
  PenLine,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { requestApi } from "../lib/api-client";
import { previewPosts } from "../lib/fixtures";
import { pickList, readableError, relativeTime } from "../lib/format";
import type { CommunityPost } from "../lib/types";
import { useSession } from "./AppShell";
import { AuthWall, EmptyState, LoadingState, PageHeading } from "./ui";

export default function CommunityScreen() {
  const { user } = useSession();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"femaleRequest" | "malePromotion">("femaleRequest");
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reportPost, setReportPost] = useState<CommunityPost | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const result = await requestApi<{ items: CommunityPost[] }>("/community/posts");
      setPosts(pickList<CommunityPost>(result));
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

  async function submitPost(event: FormEvent) {
    event.preventDefault();
    if (!topic.trim() || !content.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await requestApi<CommunityPost>("/community/posts", {
        method: "POST",
        data: { kind, topic: topic.trim(), content: content.trim() },
      });
      setPosts((items) => [created, ...items]);
      setTopic("");
      setContent("");
      setNotice("内容已提交，公开展示以服务端审核结果为准。");
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleLike(post: CommunityPost) {
    try {
      const updated = await requestApi<CommunityPost>(
        `/community/posts/${encodeURIComponent(post.id)}/like`,
        { method: "POST", data: { liked: !post.isLiked } },
      );
      setPosts((items) => items.map((item) => (item.id === post.id ? updated : item)));
    } catch (reason) {
      setError(readableError(reason));
    }
  }

  async function submitReport(event: FormEvent) {
    event.preventDefault();
    if (!reportPost || reportReason.trim().length < 2) return;
    setReporting(true);
    try {
      await requestApi(`/community/posts/${encodeURIComponent(reportPost.id)}/report`, {
        method: "POST",
        data: { reason: reportReason.trim() },
      });
      setNotice("举报已收讫。回执不代表处置结论或处理时限。");
      setReportPost(null);
      setReportReason("");
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setReporting(false);
    }
  }

  const visiblePosts = user ? posts : previewPosts;

  return (
    <div className="content-page community-page">
      <PageHeading
        eyebrow="Talk&Talk 广场"
        title="先说出此刻，再决定和谁聊"
        description="这里适合表达需求与分享近况。请勿留下联系方式、引导私联或线下见面。"
        action={
          <Link href="/safety" className="text-link">查看社区规则 <ArrowRight size={16} /></Link>
        }
      />

      {!user && (
        <div className="community-auth-row">
          <AuthWall
            title="登录后进入真实广场"
            description="公开内容、发布、点赞与举报都需要账号，以保护社区边界。"
          />
        </div>
      )}

      {user && (
        <section className="compose-card">
          <div className="compose-heading">
            <span className="compose-icon"><PenLine size={20} /></span>
            <div><h2>说说你想聊的</h2><p>内容会经过服务端审核后再决定是否公开。</p></div>
          </div>
          <form onSubmit={submitPost}>
            <div className="compose-kind">
              <button
                type="button"
                className={kind === "femaleRequest" ? "selected" : ""}
                onClick={() => setKind("femaleRequest")}
              >
                我想找人聊聊
              </button>
              {user.role === "companion" && (
                <button
                  type="button"
                  className={kind === "malePromotion" ? "selected" : ""}
                  onClick={() => setKind("malePromotion")}
                >
                  陪伴者分享
                </button>
              )}
            </div>
            <label className="field">
              <span>话题</span>
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="例如：今晚想找人说说话"
                maxLength={80}
              />
            </label>
            <label className="field">
              <span>想说的话</span>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="不必讲得完整，从你最想说的那一句开始…"
                maxLength={2000}
                rows={4}
              />
              <small>{content.length} / 2000</small>
            </label>
            <div className="compose-submit">
              <span><Sparkles size={15} /> 发布前会检查联系方式、骚扰与越界内容</span>
              <button
                type="submit"
                className="button button-primary"
                disabled={submitting || !topic.trim() || !content.trim()}
              >
                {submitting ? "正在提交…" : "发布到广场"}
                {!submitting && <Send size={16} />}
              </button>
            </div>
          </form>
        </section>
      )}

      {notice && <div className="inline-notice success">{notice}</div>}
      {error && <div className="inline-notice error">{error}</div>}
      {!user && (
        <div className="preview-notice compact">
          <span className="preview-dot" />
          <div><strong>社区内容预览</strong><span>以下为界面示例，不是真实用户发布内容。</span></div>
        </div>
      )}

      <div className="community-layout">
        <section className="feed-column">
          <div className="feed-heading">
            <h2>最近的声音</h2>
            {user && <button type="button" onClick={() => void load()}>刷新</button>}
          </div>
          {loading ? (
            <LoadingState label="正在读取广场内容…" />
          ) : visiblePosts.length ? (
            <div className="post-list">
              {visiblePosts.map((post) => (
                <article className="post-card" key={post.id}>
                  <header>
                    <span className="post-avatar">{post.authorInitials || post.authorName.slice(0, 2)}</span>
                    <div>
                      <strong>{post.authorName}</strong>
                      <small>
                        {post.kind === "femaleRequest" ? "想找人聊聊" : "陪伴者分享"} · {relativeTime(post.createdAt)}
                      </small>
                    </div>
                    <span className="post-kind">{post.kind === "femaleRequest" ? "需求" : "分享"}</span>
                  </header>
                  <p className="post-topic"># {post.topic}</p>
                  <p className="post-content">{post.content}</p>
                  <footer>
                    <button
                      type="button"
                      className={post.isLiked ? "post-action liked" : "post-action"}
                      onClick={() => user && void toggleLike(post)}
                      disabled={!user}
                    >
                      <Heart size={17} fill={post.isLiked ? "currentColor" : "none"} />
                      {post.likeCount}
                    </button>
                    <button
                      type="button"
                      className="post-action"
                      disabled={!user}
                      onClick={() => setReportPost(post)}
                    >
                      <Flag size={16} /> 举报
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="广场还很安静"
              description="发布第一条内容，或者稍后再来看看。"
            />
          )}
        </section>

        <aside className="community-aside">
          <div className="aside-card quote-card">
            <MessageSquareQuote size={24} />
            <h3>表达需求，不交换边界</h3>
            <p>可以说情绪、困扰和期待，但不要留下手机号、社交账号或线下见面的邀请。</p>
          </div>
          <div className="aside-card">
            <h3>社区里的三件小事</h3>
            <ol>
              <li><span>1</span>尊重每个人说“不”的权利</li>
              <li><span>2</span>不诊断、不羞辱、不施压</li>
              <li><span>3</span>遇到不适先停止互动并举报</li>
            </ol>
          </div>
        </aside>
      </div>

      {reportPost && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="report-title">
            <button className="modal-close" onClick={() => setReportPost(null)} aria-label="关闭">
              <X size={19} />
            </button>
            <p className="eyebrow">社区举报</p>
            <h2 id="report-title">告诉我们具体发生了什么</h2>
            <p>只填写与这条公开内容相关的简短原因。不要粘贴聊天、订单或身份信息。</p>
            <form onSubmit={submitReport}>
              <label className="field">
                <span>举报原因</span>
                <textarea
                  autoFocus
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="至少 2 个字"
                />
              </label>
              <button
                className="button button-primary button-full"
                disabled={reporting || reportReason.trim().length < 2}
              >
                {reporting ? "正在提交…" : "提交举报"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
