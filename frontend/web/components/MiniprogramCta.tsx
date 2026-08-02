"use client";

import { ArrowRight, Check, Copy, QrCode, Smartphone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { miniprogramEntryUrl, miniprogramQrUrl } from "../lib/miniprogram-entry";

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
  const hasQr = Boolean(miniprogramQrUrl);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const large = variant !== "inline";

  const copySearchTerm = async () => {
    try {
      await navigator.clipboard.writeText("Talk&Talk");
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
      {copyState === "copied" ? "已复制 Talk&Talk" : "复制名称并在微信搜索"}
      {copyState === "copied" ? <Check size={large ? 18 : 17} /> : <Copy size={large ? 18 : 17} />}
    </button>
  );

  const copyStatus = copyState === "idle"
    ? null
    : (
      <span className="miniprogram-copy-status" aria-live="polite">
        {copyState === "copied" ? "已复制，可在微信中粘贴搜索。" : "请在微信中搜索「Talk&Talk」。"}
      </span>
    );

  if (variant === "inline") {
    return (
      <div className={`miniprogram-cta inline ${className}`.trim()}>
        {miniprogramEntryUrl ? (
          <a className="button button-primary" href={miniprogramEntryUrl} rel="noreferrer">
            打开微信小程序 <Smartphone size={17} />
          </a>
        ) : (
          fallbackAction
        )}
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
        {miniprogramEntryUrl ? (
          <a className="button button-primary button-large" href={miniprogramEntryUrl} rel="noreferrer">
            打开微信小程序 <Smartphone size={18} />
          </a>
        ) : (
          fallbackAction
        )}
        <Link href={secondaryHref} className="button button-secondary button-large">
          {secondaryLabel} <ArrowRight size={18} />
        </Link>
        {copyStatus}
      </div>

      <aside className="miniprogram-qr-panel" aria-label="微信小程序入口">
        {hasQr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={miniprogramQrUrl} alt="Talk&Talk 微信小程序二维码" width={132} height={132} />
        ) : (
          <div className="miniprogram-qr-placeholder">
            <QrCode size={36} strokeWidth={1.5} />
            <span>配置二维码后可扫码打开</span>
          </div>
        )}
        <div>
          <strong>微信小程序服务入口</strong>
          <p>
            {hasQr
              ? "扫码后请以小程序页面展示的服务范围与可用状态为准。"
              : "请在微信中搜索「Talk&Talk」。网页用于了解产品与浏览体验，服务入口以小程序页面状态为准。"}
          </p>
        </div>
      </aside>
    </div>
  );
}
