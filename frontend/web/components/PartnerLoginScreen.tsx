"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { PRIVACY_URL, TERMS_URL, readConsent, saveConsent } from "../lib/api-client";
import { useSession } from "./AppShell";

export default function PartnerLoginScreen() {
  const router = useRouter();
  const { refresh } = useSession();
  const [accessCode, setAccessCode] = useState("");
  const [persona, setPersona] = useState("customer-a");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accepted || busy) return;
    setBusy(true);
    setError("");
    try {
      saveConsent();
      const response = await fetch("/api/session/login", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode: accessCode.trim(), persona, consent: readConsent() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "暂时无法登录，请重试");
      await refresh();
      router.push(persona === "companion" ? "/workbench" : "/discover");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法登录，请重试");
    } finally {
      setBusy(false);
    }
  }

  return <div className="login-page partner-login-page">
    <section className="login-story">
      <p className="consent-brand-text">Talk&amp;Talk</p>
      <h1>一起试用 Talk&amp;Talk</h1>
      <p>选择一个账号，体验预约、试聊和陪伴者工作台。手机与电脑同步保存。</p>
      <p>三个账号分别保存各自的数据，可以在两台设备上测试双方操作。测试角色由团队共享，请使用测试内容。</p>
    </section>
    <section className="login-card">
      <KeyRound size={26} aria-hidden="true" />
      <h2>进入合伙人测试</h2>
      <p className="fine-print">测试账号由团队共享，请只填写测试内容。</p>
      <form onSubmit={submit}>
        <label className="field"><span>测试口令</span><div className="input-shell">
          <input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="current-password" placeholder="粘贴收到的测试口令" required minLength={24} maxLength={128} />
        </div></label>
        <label className="field"><span>选择测试账号</span>
          <select value={persona} onChange={(event) => setPersona(event.target.value)}>
            <option value="customer-a">用户 A · 预约与聊天</option>
            <option value="customer-b">用户 B · 独立账号</option>
            <option value="companion">林屿 · 陪伴者工作台</option>
          </select>
        </label>
        <label className="check-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>我已满 18 周岁，并同意<a href={TERMS_URL} target="_blank" rel="noreferrer">《用户协议》</a>和<a href={PRIVACY_URL} target="_blank" rel="noreferrer">《隐私政策》</a>。</span>
        </label>
        {error && <p className="form-message error" role="alert">{error}</p>}
        <button className="button button-primary button-full" disabled={!accepted || accessCode.trim().length < 24 || busy}>
          {busy ? "正在进入…" : "进入测试"}<ArrowRight size={17} />
        </button>
      </form>
    </section>
  </div>;
}
