"use client";

import {
  ArrowRight,
  LockKeyhole,
  MessageCircleHeart,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import MiniprogramCta from "./MiniprogramCta";
import { HeroOrchestration } from "./motion/HeroOrchestration";
import { IconOrbit } from "./motion/IconOrbit";
import { Reveal, RevealItem, RevealStagger } from "./motion/Reveal";

const trustSignals = [
  { label: "服务入口", value: "微信小程序" },
  { label: "服务对象", value: "年满 18 周岁" },
  { label: "连接方式", value: "平台内完成" },
  { label: "边界", value: "非医疗 · 非急救" },
];

const valueProps = [
  {
    code: "01",
    title: "先被听见，再决定怎么继续",
    copy: "情绪倾听、职场减压、睡前陪伴——从真实需要出发，不必先组织成「正确」的表达。",
  },
  {
    code: "02",
    title: "连接可以亲近，边界必须清楚",
    copy: "预约、沟通与支持留在平台内可回看的路径中；私联、私下转账与线下邀约不被鼓励。",
  },
  {
    code: "03",
    title: "服务入口真实可到达",
    copy: "官网说明品牌、规则与路径；服务开放状态以微信小程序与正式公告为准。",
  },
];

const moments = [
  {
    label: "情绪倾听",
    title: "心里有点乱",
    copy: "不用先想清楚，也可以从被认真听完开始。",
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

const pathSteps = [
  {
    code: "01",
    title: "认识边界",
    copy: "先了解产品是什么、不是什么，以及如何安全使用。",
  },
  {
    code: "02",
    title: "打开小程序",
    copy: "服务入口与可约状态以微信小程序页面为准。",
  },
  {
    code: "03",
    title: "完成连接",
    copy: "预约、沟通与支持都留在平台内的可回看路径中。",
  },
];

const trustPoints = [
  {
    Icon: MessageCircleHeart,
    title: "重要互动留在平台内",
    copy: "会话、订单与支持入口彼此接得上，减少私下交接带来的风险。",
  },
  {
    Icon: LockKeyhole,
    title: "私联与私下转账不被鼓励",
    copy: "费用与退款应留在订单结构里；线下邀约不属于产品服务范围。",
  },
  {
    Icon: ShieldCheck,
    title: "陪伴不是治疗或急救",
    copy: "不提供医疗诊断、心理治疗或紧急救援；遇紧急风险请联系当地紧急服务。",
  },
  {
    Icon: Smartphone,
    title: "入口以小程序页面为准",
    copy: "网页帮助你理解规则；服务范围与开放状态以小程序页面和正式公告为准。",
  },
];

export default function MarketingHomeScreen() {
  return (
    <div className="bubble-site mint-brand site-home">
      <section className="bubble-hero mint-hero" aria-labelledby="hero-title">
        <div className="hero-surface" aria-hidden="true" />
        <HeroOrchestration
          className="bubble-hero-grid"
          brand={
            <p className="hero-brand">
              <span>Talk&amp;Talk</span>
              <i />
              女性友好的线上陪伴
            </p>
          }
          title={
            <h1 id="hero-title">
              有边界的线上陪伴，
              <span>从被认真听见开始。</span>
            </h1>
          }
          lead={
            <>
              <p className="hero-lead">
                Talk&amp;Talk 面向需要情绪倾听、减压与陪伴的成年人。发现、预约与沟通在平台内完成；
                官网说明规则与边界。文字互动开放状态以微信小程序为准；身份核验通道完成前不开放新预约、支付或聊天。
              </p>
              <ul className="hero-trust-strip" aria-label="产品可信要点">
                {trustSignals.map((item) => (
                  <li key={item.label}>
                    <small>{item.label}</small>
                    <strong>{item.value}</strong>
                  </li>
                ))}
              </ul>
            </>
          }
          actions={
            <MiniprogramCta
              variant="hero"
              secondaryHref="/how-it-works"
              secondaryLabel="了解服务路径"
            />
          }
          visual={<IconOrbit />}
        />
      </section>

      <section className="home-values" aria-labelledby="values-title">
        <Reveal as="header" className="bubble-heading">
          <p className="eyebrow">我们做什么</p>
          <h2 id="values-title">把陪伴做成可确认的服务，而不是一次偶然的聊天。</h2>
          <p>
            认真被听见需要空间，也需要分寸。Talk&amp;Talk 用同一套产品结构承接发现、约定、沟通与支持。
          </p>
        </Reveal>
        <RevealStagger className="home-value-grid" stagger={0.06}>
          {valueProps.map((item) => (
            <RevealItem key={item.code}>
              <article className="home-value-card">
                <span className="home-value-code">{item.code}</span>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            </RevealItem>
          ))}
        </RevealStagger>
      </section>

      <section className="bubble-moments" aria-labelledby="moments-title">
        <Reveal as="header" className="bubble-heading">
          <p className="eyebrow">适合这样开始</p>
          <h2 id="moments-title">不用先想清楚一切，也可以找到好好说话的空间。</h2>
          <p>以下是常见需要。服务与可约状态以微信小程序页面和正式公告为准。</p>
        </Reveal>
        <RevealStagger className="home-moment-list" stagger={0.05}>
          {moments.map((moment, index) => (
            <RevealItem key={moment.label}>
              <article className="home-moment-row">
                <span className="home-moment-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="home-moment-copy">
                  <small>{moment.label}</small>
                  <strong>{moment.title}</strong>
                  <p>{moment.copy}</p>
                </div>
              </article>
            </RevealItem>
          ))}
        </RevealStagger>
      </section>

      <section className="bubble-path mint-path home-path" aria-labelledby="path-title">
        <Reveal as="div" className="bubble-path-inner home-path-inner">
          <header className="bubble-heading bubble-heading-light">
            <p className="eyebrow">如何开始</p>
            <h2 id="path-title">官网说明规则，小程序完成连接。</h2>
            <p>官网不提供预约、支付、聊天或售后；服务开放状态以微信小程序页面和正式公告为准。</p>
          </header>
          <ol className="bubble-path-steps">
            {pathSteps.map((step) => (
              <li key={step.code}>
                <span>{step.code}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.copy}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="bubble-path-actions">
            <MiniprogramCta
              variant="inline"
              secondaryHref="/safety"
              secondaryLabel="阅读安全说明"
            />
          </div>
        </Reveal>
      </section>

      <section className="home-trust" aria-labelledby="trust-title">
        <Reveal as="header" className="bubble-heading">
          <p className="eyebrow">可信的表达方式</p>
          <h2 id="trust-title">我们用结构说明产品，不用虚构数字。</h2>
          <p>
            官网不展示未核验的规模叙事。你可以在这里理解路径与边界，再到微信小程序查看当前开放状态。
          </p>
        </Reveal>
        <RevealStagger className="home-trust-grid" stagger={0.05}>
          {trustPoints.map(({ Icon, title, copy }) => (
            <RevealItem key={title}>
              <article className="home-trust-card">
                <span className="home-trust-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            </RevealItem>
          ))}
        </RevealStagger>
        <div className="home-trust-links">
          <Link href="/about" className="button button-secondary">
            关于我们
          </Link>
          <Link href="/partners" className="button button-secondary">
            合作与联系
          </Link>
          <Link href="/safety" className="bubble-text-link">
            阅读安全说明 <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="bubble-channels" aria-labelledby="channels-title">
        <Reveal as="header" className="bubble-heading">
          <p className="eyebrow">服务入口</p>
          <h2 id="channels-title">去真正能完成连接的地方。</h2>
        </Reveal>
        <div className="bubble-channel-grid">
          <article className="bubble-channel-card primary mint-channel-primary">
            <span className="bubble-channel-icon">
              <Image
                src="/brand/app-icon.png"
                alt=""
                width={44}
                height={44}
                className="channel-app-icon"
                aria-hidden="true"
              />
            </span>
            <p className="eyebrow">状态查询入口</p>
            <h3>微信小程序</h3>
            <p>
              当前服务开放状态以小程序实际页面展示为准。身份核验通道完成前不开放新预约、支付或聊天；可在微信中搜索「Talk&amp;Talk」查看说明。
            </p>
            <MiniprogramCta
              variant="inline"
              secondaryHref="/how-it-works"
              secondaryLabel="了解服务路径"
            />
          </article>
          <article className="bubble-channel-card">
            <span className="bubble-channel-icon">
              <Smartphone size={22} aria-hidden="true" />
            </span>
            <p className="eyebrow">官网说明面</p>
            <h3>品牌、规则与公示</h3>
            <p>
              官网用于说明产品边界、公开信息和服务路径，不承接预约、支付、聊天或售后。
            </p>
            <Link href="/about" className="bubble-text-link">
              查看公开信息 <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </article>
          <article className="bubble-channel-card">
            <span className="bubble-channel-icon">
              <ShieldCheck size={22} aria-hidden="true" />
            </span>
            <p className="eyebrow">安全须知</p>
            <h3>边界与安全</h3>
            <p>了解平台内沟通、禁止私联与私下转账，以及紧急风险时的正确做法。</p>
            <Link href="/safety" className="bubble-text-link">
              阅读安全说明 <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </article>
        </div>
      </section>

      <section className="bubble-symbol home-symbol" aria-labelledby="symbol-title">
        <Reveal as="div" className="bubble-symbol-panel mint-symbol-panel">
          <div className="bubble-symbol-copy">
            <p className="eyebrow">品牌符号</p>
            <h2 id="symbol-title">两枚对话相遇，形成一颗温柔的心。</h2>
            <p>
              产品图标里的对话气泡、中心的心与环状守护，定义了 Talk&amp;Talk 的气质：
              连接可以亲密，边界必须清楚——柔和、可亲近，但不廉价。
            </p>
            <ul className="bubble-symbol-list">
              <li>
                <strong>双向对话</strong>
                <span>倾听与回应相遇，而不是单向输出。</span>
              </li>
              <li>
                <strong>心与边界并存</strong>
                <span>温柔被看见，但不吞没各自的空间。</span>
              </li>
              <li>
                <strong>结构守护关系</strong>
                <span>外环与空泡提醒：靠近可以，越界不可以。</span>
              </li>
            </ul>
          </div>
          <figure className="bubble-symbol-visual mint-icon-stage">
            <div className="mint-icon-glow" aria-hidden="true" />
            <Image
              src="/brand/app-icon.png"
              alt="Talk&Talk 官方图标：两枚对话气泡交叠成心，周围漂浮空泡"
              width={420}
              height={420}
              className="bubble-symbol-image mint-icon-image"
              priority={false}
            />
            <figcaption>产品图标即官网视觉源：对话 · 心 · 守护</figcaption>
          </figure>
        </Reveal>
      </section>

      <Reveal as="section" className="bubble-closing mint-closing">
        <div className="bubble-closing-inner">
          <div>
            <p className="eyebrow">开始一段有分寸的连接</p>
            <h2>先认识规则，再进入小程序。</h2>
            <p>
              网页帮助你理解产品与边界；服务开放状态请以微信小程序页面和正式公告为准。
            </p>
          </div>
          <MiniprogramCta
            variant="panel"
            secondaryHref="/how-it-works"
            secondaryLabel="了解服务路径"
          />
        </div>
      </Reveal>
    </div>
  );
}
