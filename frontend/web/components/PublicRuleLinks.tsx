import Link from "next/link";

import { PRIVACY_URL, TERMS_URL } from "../lib/api-client";

export function PublicRuleLinks({ className = "" }: { className?: string }) {
  return (
    <nav className={`public-rule-links ${className}`.trim()} aria-label="完整规则与政策">
      <Link href="/safety">安全说明</Link>
      <a href={TERMS_URL} target="_blank" rel="noreferrer">用户协议与平台规则</a>
      <a href={PRIVACY_URL} target="_blank" rel="noreferrer">隐私政策</a>
    </nav>
  );
}
