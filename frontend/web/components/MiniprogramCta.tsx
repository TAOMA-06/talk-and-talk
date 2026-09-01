"use client";

import { ArrowRight, Check, Copy, QrCode, Smartphone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  miniprogramSearchName,
  resolveMiniprogramEntry,
  resolveMiniprogramQr,
} from "../lib/miniprogram-entry";

type MiniprogramCtaProps = {
  variant?: "hero" | "panel" | "inline";
  secondaryHref?: string;
  secondaryLabel?: string;
  className?: string;
};

export default function MiniprogramCta({
  variant = "hero",
  secondaryHref = "/how-it-works",
  secondaryLabel = "了解服务路径",
  className = "",
}: MiniprogramCtaProps) {
  const entry = resolveMiniprogramEntry();
  const qr = resolveMiniprogramQr();
  const hasQr = qr.kind === "qr";
  const searchName = entry.kind === "fallback" ? entry.searchName : miniprogramSearchName;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const large = variant !== "inline";

  const copySearchTerm = async () => {
    try {
      await navigator.clipboard.writeText(searchName);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  };

  const fallbackAction = (
    <button
      type="button"
      className={`button button-primary${large ? " button-large" : ""}`}
      onClick={() => void copySearchTerm()}
    >
      {copyState === "copied" ? `已复制 ${searchName}` : "复制小程序名称"}
      {copyState === "copied" ? <Check size={large ? 18 : 17} /> : <Copy size={large ? 18 : 17} />}
    </button>
  );

  const primaryAction = entry.kind === "path" ? (
    <a
      className={`button button-primary${large ? " button-large" : ""}`}
      href={entry.href}
      rel="noreferrer"
    >
      打开微信小程序 <Smartphone size={large ? 18 : 17} />
    </a>
  ) : (
    fallbackAction
  );

  const copyStatus = copyState === "idle"
    ? null
    : (
      <span className="miniprogram-copy-status" aria-live="polite">
        {copyState === "copied" ? "已复制。" : "请在微信搜索「Talk&Talk」。"}
      </span>
    );

  if (variant === "inline") {
    return (
      <div className={`miniprogram-cta inline ${className}`.trim()}>
        {primaryAction}
        <Link href={secondaryHref} className="button button-secondary">
          {secondaryLabel} <ArrowRight size={16} />
        </Link>
        {copyStatus}
      </div>
    );
  }

  return (
    <div className={`miniprogram-cta ${variant} ${className}`.trim()}>
      <div className="miniprogram-cta-actions">
        {primaryAction}
        <Link href={secondaryHref} className={`button button-secondary${large ? " button-large" : ""}`}>
          {secondaryLabel} <ArrowRight size={large ? 18 : 16} />
        </Link>
        {copyStatus}
      </div>

      <aside className="miniprogram-qr-panel" aria-label="微信小程序入口">
        {qr.kind === "qr" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr.href} alt="Talk&Talk 微信小程序二维码" width={132} height={132} />
        ) : (
          <div className="miniprogram-qr-placeholder">
            <QrCode size={36} strokeWidth={1.5} />
            <span>微信搜索 Talk&amp;Talk</span>
          </div>
        )}
        <div>
          <strong>微信小程序</strong>
          <p>{hasQr ? "扫码打开" : "微信搜索 Talk&Talk"}</p>
        </div>
      </aside>
    </div>
  );
}
