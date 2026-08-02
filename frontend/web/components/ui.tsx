"use client";

import {
  ArrowRight,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  Star,
} from "lucide-react";
import Link from "next/link";

import { availabilityLabel, currency, dateTime } from "../lib/format";
import type { Companion } from "../lib/types";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-heading-action">{action}</div>}
    </header>
  );
}

export function LoadingState({ label = "正在加载…" }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="state-card empty-state">
      <span className="state-icon"><CircleAlert size={22} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function AuthWall({
  title = "登录后继续",
  description = "登录后才能查看属于你的内容和执行操作。",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="auth-wall">
      <span className="auth-wall-icon"><LockKeyhole size={28} /></span>
      <p className="eyebrow">私人空间</p>
      <h2>{title}</h2>
      <p>{description}</p>
      <Link href="/login" className="button button-primary">
        手机号登录
        <ArrowRight size={17} />
      </Link>
    </div>
  );
}

export function StatusBadge({ label, tone = "muted" }: { label: string; tone?: string }) {
  return <span className={`status-badge status-${tone}`}>{label}</span>;
}

export function CompanionCard({
  companion,
}: {
  companion: Companion;
  featured?: boolean;
}) {
  const price = companion.catalog?.startingPriceCents;
  const nextAvailable = companion.catalog?.nextAvailableAt;
  const avatarTone = (companion.name.codePointAt(0) || 0) % 4;
  return (
    <Link
      href={`/companions/${encodeURIComponent(companion.id)}`}
      className="companion-card"
    >
      <div className={`avatar companion-card-media avatar-tone-${avatarTone}`}>
        <span>{companion.initials || companion.name.slice(0, 2)}</span>
        {companion.isOnline && <i aria-label="在线" />}
      </div>
      <div className="companion-card-body">
        <div className="companion-card-heading">
          <div>
            <div className="name-line">
              <h3>{companion.name}</h3>
              {companion.isVerified && <span className="verified-label">已认证</span>}
            </div>
            <p className="companion-role">
              {companion.role}
              {companion.availability ? ` · ${availabilityLabel(companion.availability)}` : ""}
            </p>
          </div>
          <span className="rating">
            <Star size={14} fill="currentColor" />
            {companion.rating.toFixed(1)}
            {companion.reviewCount ? <small>· {companion.reviewCount}</small> : null}
          </span>
        </div>
        {companion.reasonText && (
          <p className="recommendation-reason">{companion.reasonText}</p>
        )}
        <p className="companion-bio">{companion.bio}</p>
        {!!(companion.specialties || companion.tags)?.length && (
          <div className="tag-row companion-card-tags">
            {(companion.specialties || companion.tags || []).slice(0, 3).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
        <div className="companion-card-footer">
          <div>
            <strong>
              {price === null || price === undefined ? "暂未定价" : `${currency(price)} 起`}
            </strong>
            <small>
              {companion.catalog?.startingDurationMinutes
                ? ` / ${companion.catalog.startingDurationMinutes} 分钟`
                : ""}
            </small>
          </div>
          <span className="availability-note">
            {nextAvailable
              ? `${dateTime(nextAvailable)}可约`
              : availabilityLabel(companion.availability)}
          </span>
        </div>
        <div className="companion-card-action">
          <span>查看资料与服务</span>
          <ArrowRight size={16} />
        </div>
      </div>
    </Link>
  );
}
