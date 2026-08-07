import {
  ArrowRight,
  CalendarCheck2,
  CircleHelp,
  MessageCircleHeart,
  ShieldCheck,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import MiniprogramCta from "./MiniprogramCta";
import { Reveal, RevealItem, RevealStagger } from "./motion/Reveal";

const steps = [
  {
    code: "01",
    label: "发现与选择",
    title: "先从公开资料和服务方式认识彼此",
    copy: "浏览陪伴者资料、主题、服务方式与可约时间。你可以先了解，再决定是否发起预约。",
    note: "公开资料 · 服务商品 · 可约时间",
    Icon: UserRoundCheck,
  },
  {
    code: "02",
    label: "预约与确认",
    title: "把时间、价格和状态说清楚",
    copy: "发起预约后，由陪伴者确认服务时段。平台用同一份订单状态承接双方的下一步。",
    note: "预约请求 · 时段容量 · 订单确认",
    Icon: CalendarCheck2,
  },
  {
    code: "03",
    label: "交易与履约",
    title: "让一次约定留在可回看的结构里",
    copy: "支付、服务进度、取消与退款状态都围绕订单发生；服务入口以微信小程序页面状态为准。",
    note: "平台支付 · 服务状态 · 退款处理",
    Icon: WalletCards,
  },
  {
    code: "04",
    label: "沟通与支持",
    title: "把要说的话留在可支持的空间",
    copy: "服务后的平台内会话、举报与售后支持共同承接关键边界，不需要依赖私下交接。",
    note: "平台内沟通 · 举报入口 · 售后支持",
    Icon: MessageCircleHeart,
  },
];

const faqs = [
  {
    question: "Talk&Talk 提供心理治疗或紧急救援吗？",
    answer: "不提供。Talk&Talk 是线上陪伴平台，不替代心理咨询、精神科诊疗或紧急救援。遇到紧急风险请立即联系当地紧急服务。",
  },
  {
    question: "为什么需要留在平台内沟通和交易？",
    answer: "平台内的订单、沟通和支持路径能够让服务边界更清楚，也便于在需要时提供举报、售后与规则支持。",
  },
  {
    question: "网页和微信小程序分别承担什么？",
    answer: "网页用于了解产品、浏览公开资料和体验产品路径；服务入口与履约以微信小程序实际配置和页面状态为准。",
  },
];

export default function HowItWorksScreen() {
  return (
    <div className="marketing-detail-page how-it-works-page">
      <section className="marketing-detail-hero marketing-detail-hero-split how-it-works-hero">
        <div className="marketing-detail-hero-copy">
          <p className="hero-brand"><span>产品如何运作</span><i /> 服务路径说明</p>
          <h1>把一次认真连接，放进一条清楚的服务路径。</h1>
          <p>
            从公开资料到预约确认，从平台支付到服务沟通与支持——每一步都应接得上。
            服务入口与履约以微信小程序页面状态为准。
          </p>
          <div className="marketing-detail-actions">
            <Link href="/demo" className="button button-primary button-large">
              进入网页产品演示 <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link href="/safety" className="button button-secondary button-large">
              查看安全与支持
            </Link>
          </div>
        </div>
        <aside className="how-hero-map" aria-label="可信陪伴链结构示意">
          <div className="how-hero-map-head">
            <span>可信陪伴链</span>
            <small>01 / 04</small>
          </div>
          <ol>
            <li><span>01</span><strong>发现</strong><small>公开资料与服务方式</small></li>
            <li><span>02</span><strong>预约</strong><small>时间、价格与确认</small></li>
            <li><span>03</span><strong>履约</strong><small>订单与平台内沟通</small></li>
            <li><span>04</span><strong>支持</strong><small>举报、售后与规则入口</small></li>
          </ol>
          <p><ShieldCheck size={16} aria-hidden="true" /> 让每一步都有清楚的下一步</p>
        </aside>
      </section>

      <section className="marketing-detail-section journey-explainer">
        <Reveal as="header" className="editorial-heading editorial-heading-wide">
          <p className="eyebrow">可信陪伴链</p>
          <h2>每一步都有它该在的位置。</h2>
          <p>平台将重要的服务状态放在可理解、可确认、可支持的路径上。</p>
        </Reveal>
        <RevealStagger className="journey-explainer-grid" stagger={0.1}>
          {steps.map(({ Icon, code, label, title, copy, note }) => (
            <RevealItem key={code}>
              <article className="journey-explainer-card">
                <div>
                  <span>{code}</span>
                  <Icon size={21} aria-hidden="true" />
                </div>
                <small>{label}</small>
                <h3>{title}</h3>
                <p>{copy}</p>
                <strong>{note}</strong>
              </article>
            </RevealItem>
          ))}
        </RevealStagger>
      </section>

      <Reveal as="section" className="marketing-boundary-callout">
        <span><ShieldCheck size={24} aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">规则是体验的一部分</p>
          <h2>边界不是后置提示，而是服务从一开始就有的结构。</h2>
          <p>我们不鼓励私联、私下转账或线下邀约。重要过程留在平台内，才有明确的规则和支持入口。</p>
        </div>
        <Link href="/safety" className="text-link">阅读完整说明 <ArrowRight size={16} aria-hidden="true" /></Link>
      </Reveal>

      <section className="marketing-detail-section faq-section">
        <Reveal as="header" className="editorial-heading editorial-heading-wide">
          <p className="eyebrow">常见问题</p>
          <h2>在开始之前，先把重要的事问清楚。</h2>
        </Reveal>
        <RevealStagger className="faq-list" stagger={0.08}>
          {faqs.map((faq, index) => (
            <RevealItem key={faq.question}>
              <details className="faq-item">
                <summary>
                  <CircleHelp size={18} aria-hidden="true" />
                  <span>{faq.question}</span>
                </summary>
                <p id={`faq-answer-${index}`}>{faq.answer}</p>
              </details>
            </RevealItem>
          ))}
        </RevealStagger>
      </section>

      <Reveal as="section" className="marketing-detail-cta">
        <div>
          <p className="eyebrow">下一步</p>
          <h2>先看清楚，再选择怎么开始。</h2>
          <p>网页可以帮助你认识产品；服务入口以微信小程序页面状态为准。</p>
        </div>
        <MiniprogramCta variant="panel" secondaryHref="/demo" secondaryLabel="进入网页产品演示" />
      </Reveal>
    </div>
  );
}
