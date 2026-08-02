"use client";

import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck2,
  HeartHandshake,
  MessageCircleHeart,
  ShieldCheck,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import MiniprogramCta from "./MiniprogramCta";
import { ConnectionPulse } from "./motion/ConnectionPulse";
import { HeroOrchestration } from "./motion/HeroOrchestration";
import { TrustJourney } from "./motion/TrustJourney";
import { Reveal, RevealItem, RevealStagger } from "./motion/Reveal";

const proofPoints = [
  {
    title: "资料有展示规则",
    copy: "公开前经过平台流程",
    Icon: UserRoundCheck,
  },
  {
    title: "服务可确认",
    copy: "时间、价格与状态说清楚",
    Icon: CalendarCheck2,
  },
  {
    title: "沟通留在站内",
    copy: "关键过程有支持入口",
    Icon: MessageCircleHeart,
  },
  {
    title: "问题有迹可循",
    copy: "订单、举报与售后相连接",
    Icon: ShieldCheck,
  },
];

const moments = [
  {
    label: "情绪倾听",
    title: "心里有点乱",
    copy: "不用先组织好语言，也可以从被认真听完开始。",
  },
  {
    label: "职场减压",
    title: "工作消耗太多",
    copy: "先把此刻的压力说出来，再决定怎么继续。",
  },
  {
    label: "睡前陪伴",
    title: "今晚不想独处",
    copy: "在时间、方式和边界都清楚的情况下，安静待一会儿。",
  },
];

const serviceSteps = [
  {
    code: "01 / 发现",
    title: "从公开资料开始选择",
    copy: "主题、服务方式与可约时间集中呈现，让“合不合适”有可以比较的依据。",
    Icon: UserRoundCheck,
  },
  {
    code: "02 / 预约",
    title: "把一次约定讲清楚",
    copy: "预约、确认与时段容量共享同一条状态路径，减少猜测和反复确认。",
    Icon: CalendarCheck2,
  },
  {
    code: "03 / 履约",
    title: "把关系留在可支持的空间",
    copy: "支付、平台内沟通、订单进度与售后支持相互连接，不用转向私下交接。",
    Icon: WalletCards,
  },
];

const audiencePaths = [
  {
    eyebrow: "正在寻找陪伴",
    title: "先看看哪些连接方式适合你",
    copy: "网页可以浏览公开资料与产品规则；服务入口以微信小程序页面状态为准。",
    href: "/demo?stage=discover#demo-route",
    action: "查看网页产品演示",
    Icon: HeartHandshake,
  },
  {
    eyebrow: "陪伴者工作台",
    title: "用同一个账号管理服务与履约",
    copy: "服务商品、可约时段、订单和履约信息在同一套产品结构里协同。",
    href: "/demo?stage=delivery#demo-route",
    action: "查看工作台产品演示",
    Icon: BriefcaseBusiness,
  },
  {
    eyebrow: "机构、媒体与合作",
    title: "从边界清楚的合作开始",
    copy: "面向组织关怀、女性社区、媒体与行业交流，先明确服务范围与隐私边界。",
    href: "/partners",
    action: "了解合作方式",
    Icon: ShieldCheck,
  },
];

export default function MarketingHomeScreen() {
  return (
    <div className="marketing-page marketing-page-redesign">
      <section className="marketing-hero marketing-hero-redesign">
        <HeroOrchestration
          className="marketing-hero-grid marketing-hero-grid-redesign"
          brand={
            <p className="hero-brand">
              <span>Talk&amp;Talk</span>
              <i />
              有边界的线上陪伴
            </p>
          }
          title={
            <h1 id="hero-title">
              认真倾听，不该只是一句温柔的话。
              <span>它也该有一条让人安心的路径。</span>
            </h1>
          }
          lead={
            <p className="hero-lead">
              Talk&amp;Talk 是女性友好的线上陪伴平台。我们把发现、预约、支付、沟通与支持留在同一套可信结构里，让每一次连接都有分寸、有回应。
            </p>
          }
          actions={<MiniprogramCta variant="hero" secondaryHref="/how-it-works" secondaryLabel="了解服务路径" />}
          visual={<ConnectionPulse />}
        />
      </section>

      <Reveal className="marketing-proof-rail" as="section">
        <RevealStagger className="marketing-proof-grid">
          {proofPoints.map(({ Icon, title, copy }) => (
            <RevealItem key={title}>
              <article>
                <span><Icon size={19} aria-hidden="true" /></span>
                <div>
                  <strong>{title}</strong>
                  <small>{copy}</small>
                </div>
              </article>
            </RevealItem>
          ))}
        </RevealStagger>
      </Reveal>

      <TrustJourney />

      <section className="marketing-section marketing-moment-section">
        <Reveal as="header" className="editorial-heading editorial-heading-wide">
          <p className="eyebrow">从你此刻的需要出发</p>
          <h2>不用先把一切想清楚，先找到能好好说话的空间。</h2>
          <p>主题只是开始，不会替你定义正在经历什么。</p>
        </Reveal>
        <RevealStagger className="marketing-moment-grid marketing-moment-grid-redesign" stagger={0.1}>
          {moments.map((moment) => (
            <RevealItem key={moment.label}>
              <Link href="/demo?stage=discover#demo-route" className="marketing-moment-card">
                <small>{moment.label}</small>
                <strong>{moment.title}</strong>
                <span>{moment.copy}</span>
                <span className="marketing-card-link">查看网页产品演示 <ArrowRight size={16} aria-hidden="true" /></span>
              </Link>
            </RevealItem>
          ))}
        </RevealStagger>
      </section>

      <section className="marketing-section marketing-system-section">
        <Reveal as="header" className="editorial-heading editorial-heading-wide">
          <p className="eyebrow">服务如何发生</p>
          <h2>温度留给交流，规则留给平台承接。</h2>
          <p>不是把流程变复杂，而是让每一次选择和支持都有清楚的去处。</p>
        </Reveal>
        <RevealStagger className="service-system-grid" stagger={0.12}>
          {serviceSteps.map(({ Icon, code, title, copy }) => (
            <RevealItem key={code}>
              <article className="service-system-card">
                <div className="service-system-head">
                  <span>{code}</span>
                  <Icon size={21} aria-hidden="true" />
                </div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            </RevealItem>
          ))}
        </RevealStagger>
        <Reveal as="div" className="service-system-note">
          <span><ShieldCheck size={18} aria-hidden="true" /></span>
          <p>Talk&amp;Talk 不提供心理治疗、医疗诊断或紧急救援；遇到紧急风险请立即联系当地紧急服务。</p>
          <Link href="/how-it-works">查看完整服务说明 <ArrowRight size={16} aria-hidden="true" /></Link>
        </Reveal>
      </section>

      <section className="marketing-section marketing-audience-section">
        <Reveal as="header" className="editorial-heading editorial-heading-wide">
          <p className="eyebrow">不止一个入口</p>
          <h2>一套可信结构，服务不同角色的真实需要。</h2>
          <p>用户、陪伴者与合作方都应看见清楚的下一步，而不是被迫进入同一条路径。</p>
        </Reveal>
        <RevealStagger className="marketing-audience-grid" stagger={0.1}>
          {audiencePaths.map(({ Icon, eyebrow, title, copy, href, action }) => (
            <RevealItem key={eyebrow}>
              <article className="marketing-audience-card">
                <span className="audience-icon"><Icon size={22} aria-hidden="true" /></span>
                <p>{eyebrow}</p>
                <h3>{title}</h3>
                <span>{copy}</span>
                <Link href={href} className="audience-link">
                  {action} <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </article>
            </RevealItem>
          ))}
        </RevealStagger>
      </section>

      <Reveal as="section" className="marketing-safety-band marketing-safety-band-redesign">
        <div>
          <p className="eyebrow">边界与安全</p>
          <h2>真正让人放松的，不是没有规则，而是规则足够清楚。</h2>
          <p>
            我们不鼓励私联、私下转账或线下邀约。平台内沟通、订单状态、举报与支持入口共同承接关键边界。
          </p>
          <Link href="/safety" className="button button-secondary">
            阅读安全与支持说明 <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <ul className="marketing-safety-list">
          <li><MessageCircleHeart size={18} aria-hidden="true" /> 重要沟通留在平台内</li>
          <li><WalletCards size={18} aria-hidden="true" /> 交易与状态使用同一订单</li>
          <li><ShieldCheck size={18} aria-hidden="true" /> 遇到问题有明确支持入口</li>
        </ul>
      </Reveal>

      <Reveal as="section" className="marketing-closing marketing-closing-redesign">
        <div>
          <p className="eyebrow">开始一段有分寸的连接</p>
          <h2>先认识规则，再放心开始。</h2>
          <p>服务入口以微信小程序页面状态为准。网页可以先帮你了解产品、浏览公开资料与确认边界。</p>
        </div>
        <MiniprogramCta variant="panel" secondaryHref="/how-it-works" secondaryLabel="了解服务路径" />
      </Reveal>
    </div>
  );
}
