"use client";

import {
  ArrowRight,
  Ban,
  CircleHelp,
  FileWarning,
  HeartHandshake,
  LockKeyhole,
  MessageCircleWarning,
  ShieldCheck,
  Siren,
} from "lucide-react";
import Link from "next/link";

import { PRIVACY_URL, TERMS_URL } from "../lib/api-client";
import MiniprogramCta from "./MiniprogramCta";
import { Reveal } from "./motion/Reveal";

const principles = [
  {
    title: "只在平台内沟通",
    copy: "不交换联系方式，不线下见面或私下交易。",
    Icon: LockKeyhole,
  },
  {
    title: "会话有安全出口",
    copy: "随时停止、静音、举报或提交售后。",
    Icon: MessageCircleWarning,
  },
  {
    title: "举报是线索，不是结论",
    copy: "回执只表示已收到，不代表已经处罚或风险解除。",
    Icon: FileWarning,
  },
  {
    title: "陪伴不是治疗",
    copy: "不提供诊断、治疗、急救、法律或投资建议。",
    Icon: HeartHandshake,
  },
];

const boundaries = [
  {
    title: "要求私联或线下见面",
    copy: "包括添加社交账号、交换电话或到私人场所见面",
  },
  {
    title: "要求私下转账或购买外部服务",
    copy: "所有费用与退款都应留在平台订单中",
  },
  {
    title: "骚扰、羞辱、威胁或情感操控",
    copy: "你可以停止互动，不必先说服对方",
  },
  {
    title: "承诺治疗效果或替代专业帮助",
    copy: "“已认证”不等于医疗、咨询或其他专业资质",
  },
];

export default function SafetyScreen() {
  return (
    <div className="marketing-detail-page safety-page site-safety-page">
      <section className="marketing-detail-hero marketing-detail-hero-split">
        <div className="marketing-detail-hero-copy">
          <p className="hero-brand">
            <span>安全与支持</span>
            <i />
            边界写进结构
          </p>
          <h1>安心不是一句承诺，而是一组清楚的边界。</h1>
          <p>举报、售后与会话支持以小程序对应页面为准。</p>
          <div className="marketing-detail-actions">
            <MiniprogramCta
              variant="inline"
              secondaryHref="/how-it-works"
              secondaryLabel="了解服务路径"
            />
          </div>
        </div>
        <aside className="site-safety-aside" aria-label="先保护自己">
          <span><ShieldCheck size={28} aria-hidden="true" /></span>
          <h2>先保护自己，再继续互动</h2>
          <p>感到不适、被施压或被诱导离开平台时，立即停止互动；不必等待平台结论。</p>
        </aside>
      </section>

      <section className="site-safety-principles" aria-label="安全原则">
        <Reveal as="header" className="site-heading">
          <p className="eyebrow">安全原则</p>
          <h2>四条安全底线。</h2>
        </Reveal>
        <div className="safety-grid">
          {principles.map(({ Icon, title, copy }) => (
            <article key={title}>
              <span><Icon size={22} aria-hidden="true" /></span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="boundary-section">
        <div className="boundary-copy">
          <p className="eyebrow">遇到这些情况，请先停止互动</p>
          <h2>越界不需要被合理化</h2>
        </div>
        <div className="boundary-list">
          {boundaries.map((item) => (
            <div key={item.title}>
              <Ban size={19} aria-hidden="true" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.copy}</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="urgent-card" role="note">
        <span><Siren size={27} aria-hidden="true" /></span>
        <div>
          <h2>如果存在即时人身危险或急性医疗风险</h2>
          <p>
            请停止使用平台聊天寻求救助，立即联系你所在地区可用的紧急服务或可信赖的现实支持者。
            Talk&amp;Talk 不能提供紧急响应。
          </p>
        </div>
      </section>

      <section className="help-section">
        <div>
          <p className="eyebrow">需要处理？</p>
          <h2>选择入口</h2>
        </div>
        <div className="help-cards">
          <Link href="/how-it-works">
            <MessageCircleWarning size={21} aria-hidden="true" />
            <span>
              <strong>聊天或互动问题</strong>
              <small>打开小程序会话</small>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link href="/how-it-works">
            <CircleHelp size={21} aria-hidden="true" />
            <span>
              <strong>订单、履约或退款问题</strong>
              <small>打开小程序订单</small>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <a href={TERMS_URL} target="_blank" rel="noreferrer">
            <FileWarning size={21} aria-hidden="true" />
            <span>
              <strong>小程序平台规则</strong>
              <small>交易、内容与争议规则</small>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </a>
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
            <LockKeyhole size={21} aria-hidden="true" />
            <span>
              <strong>小程序个人信息权利</strong>
              <small>查询、删除、撤回与投诉</small>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </section>
    </div>
  );
}
