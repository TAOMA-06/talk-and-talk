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
    copy: "不要交换手机号、社交账号或收款方式，不接受线下见面和私下交易。",
    Icon: LockKeyhole,
  },
  {
    title: "会话有安全出口",
    copy: "可以静音、停止互动、举报具体消息，或从订单入口提交售后问题。",
    Icon: MessageCircleWarning,
  },
  {
    title: "举报是线索，不是结论",
    copy: "举报回执只表示平台已收到，不代表处罚、处理时限或风险已经解除。",
    Icon: FileWarning,
  },
  {
    title: "陪伴不是治疗",
    copy: "平台不提供医疗诊断、心理治疗、紧急救援、法律或投资建议。",
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
          <p>
            了解资料核验、平台内沟通、举报复核和订单售后各自能做什么。
            服务中的举报与售后入口以微信小程序对应页面为准。
          </p>
          <div className="marketing-detail-actions">
            <Link href="/demo" className="button button-primary button-large">
              查看网页产品演示 <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link href="/how-it-works" className="button button-secondary button-large">
              了解服务路径
            </Link>
          </div>
        </div>
        <aside className="site-safety-aside" aria-label="先保护自己">
          <span><ShieldCheck size={28} aria-hidden="true" /></span>
          <h2>先保护自己，再继续互动</h2>
          <p>
            任何让你不适、被施压或被诱导离开平台的互动，都可以立即停止。
            你不必先说服对方，也不必等待平台结论。
          </p>
        </aside>
      </section>

      <section className="site-safety-principles" aria-label="安全原则">
        <Reveal as="header" className="site-heading">
          <p className="eyebrow">安全原则</p>
          <h2>把关键边界说清楚，是体验的一部分。</h2>
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
          <p>无论对方自称出于关心、专业判断或特殊需要，以下行为都不应发生。</p>
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
          <p className="eyebrow">选择正确的入口</p>
          <h2>不同问题，走不同路径</h2>
          <p className="help-section-lead">
            网页说明边界与路径；实际举报、售后与会话支持以微信小程序对应页面状态为准。
          </p>
        </div>
        <div className="help-cards">
          <Link href="/how-it-works">
            <MessageCircleWarning size={21} aria-hidden="true" />
            <span>
              <strong>聊天或互动问题</strong>
              <small>服务中的支持入口以微信小程序对应会话页面为准</small>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link href="/how-it-works">
            <CircleHelp size={21} aria-hidden="true" />
            <span>
              <strong>订单、履约或退款问题</strong>
              <small>服务中的支持入口以微信小程序对应订单页面为准</small>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <a href={TERMS_URL} target="_blank" rel="noreferrer">
            <FileWarning size={21} aria-hidden="true" />
            <span>
              <strong>小程序平台规则</strong>
              <small>查看服务、交易、内容与争议处理边界</small>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </a>
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
            <LockKeyhole size={21} aria-hidden="true" />
            <span>
              <strong>小程序个人信息权利</strong>
              <small>查看查询、更正、删除、撤回与投诉方式</small>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="safety-closing-cta" aria-label="服务入口">
        <div>
          <p className="eyebrow">需要在服务中寻求支持</p>
          <h2>进入小程序后使用对应页面的举报与售后入口。</h2>
          <p>本页只说明边界与路径，不替代小程序内的实时支持流程。</p>
        </div>
        <MiniprogramCta variant="panel" secondaryHref="/how-it-works" secondaryLabel="了解服务路径" />
      </section>
    </div>
  );
}
