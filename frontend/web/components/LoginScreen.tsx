"use client";

import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import {
  PRIVACY_URL,
  TERMS_URL,
  loginWithPhone,
  readConsent,
  saveConsent,
  sendSmsCode,
} from "../lib/api-client";
import { readableError } from "../lib/format";
import { useSession } from "./AppShell";

export default function LoginScreen() {
  const router = useRouter();
  const { user, refresh } = useSession();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [agreement, setAgreement] = useState(false);
  const [adult, setAdult] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const consent = readConsent();
      if (consent) {
        setAgreement(true);
        setAdult(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function sendCode() {
    if (!/^1\d{10}$/.test(phone)) {
      setError("请输入正确的 11 位手机号");
      return;
    }
    if (!agreement || !adult) {
      setError("请先阅读并同意协议，并确认已年满 18 周岁");
      return;
    }
    setSending(true);
    setError("");
    setMessage("");
    try {
      saveConsent();
      const result = await sendSmsCode(phone);
      setCountdown(result.expiresInSeconds || 60);
      setMessage("验证码已发送，请留意短信");
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setSending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agreement || !adult) {
      setError("请先完成协议与年龄确认");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      saveConsent();
      await loginWithPhone(phone, code);
      await refresh();
      router.push("/profile");
      router.refresh();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setSubmitting(false);
    }
  }

  if (user) {
    return (
      <div className="login-page">
        <section className="login-success">
          <span><CheckCircle2 size={32} /></span>
          <p className="eyebrow">已经登录</p>
          <h1>欢迎回来</h1>
          <p>你的订单、消息和工作台都已准备好。</p>
          <button className="button button-primary" onClick={() => router.push("/profile")}>
            进入我的空间 <ArrowRight size={17} />
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="login-page">
      <section className="login-story">
        <p className="consent-brand-text">Talk&amp;Talk</p>
        <h1>用手机号登录，把每一次沟通留在平台内</h1>
        <p>
          使用短信验证码登录。预约、消息与支持都在同一可信空间完成。
        </p>
        <div className="login-benefits">
          <div><ShieldCheck size={20} /><span><strong>安全边界</strong><small>聊天、订单与支持均在平台内</small></span></div>
          <div><Smartphone size={20} /><span><strong>无需密码</strong><small>一次性短信验证码登录</small></span></div>
          <div><KeyRound size={20} /><span><strong>会话受保护</strong><small>令牌保存在安全 Cookie 中</small></span></div>
        </div>
      </section>

      <section className="login-card">
        <p className="eyebrow">手机号登录</p>
        <h2>继续你的陪伴旅程</h2>
        <p className="login-card-copy">新手机号验证后会创建账号。</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>手机号</span>
            <div className="input-shell">
              <span className="country-code">+86</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="请输入 11 位手机号"
              />
            </div>
          </label>
          <label className="field">
            <span>短信验证码</span>
            <div className="input-shell">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="请输入验证码"
              />
              <button
                type="button"
                className="code-button"
                disabled={sending || countdown > 0}
                onClick={sendCode}
              >
                {sending ? "发送中…" : countdown > 0 ? `${countdown}s 后重发` : "获取验证码"}
              </button>
            </div>
          </label>
          <div className="login-consent" aria-label="登录同意">
            <label className="check-row">
              <input
                type="checkbox"
                checked={agreement}
                onChange={(event) => setAgreement(event.target.checked)}
              />
              <span>
                我已阅读并同意
                <a href={TERMS_URL} target="_blank" rel="noreferrer">《用户协议》</a>
                与
                <a href={PRIVACY_URL} target="_blank" rel="noreferrer">《隐私政策》</a>
              </span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={adult}
                onChange={(event) => setAdult(event.target.checked)}
              />
              <span>我确认已年满 18 周岁，并理解 Talk&amp;Talk 不是心理治疗或紧急救援服务</span>
            </label>
          </div>
          {message && <p className="form-message success">{message}</p>}
          {error && <p className="form-message error">{error}</p>}
          <button
            type="submit"
            className="button button-primary button-full"
            disabled={
              submitting ||
              !agreement ||
              !adult ||
              !/^1\d{10}$/.test(phone) ||
              code.length < 4
            }
          >
            {submitting ? "正在登录…" : "登录并继续"}
            {!submitting && <ArrowRight size={17} />}
          </button>
        </form>
        <p className="fine-print">
          同意记录会随登录提交到服务端留存；你可以在个人中心撤回同意或申请注销。
        </p>
      </section>
    </div>
  );
}
