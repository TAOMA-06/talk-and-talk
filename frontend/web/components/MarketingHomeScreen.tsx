"use client";

import {
  ArrowRight,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import MiniprogramCta from "./MiniprogramCta";
import { PublicRuleLinks } from "./PublicRuleLinks";
import { HeroOrchestration } from "./motion/HeroOrchestration";
import { Reveal, RevealItem, RevealStagger } from "./motion/Reveal";
import { TheatreStage } from "./motion/TheatreStage";

const trustSignals = [
  { label: "服务入口", value: "微信小程序" },
  { label: "服务对象", value: "年满 18 周岁" },
  { label: "连接方式", value: "平台内完成" },
  { label: "边界", value: "非医疗 · 非急救" },
];

const moments = [
  {
    label: "情绪倾听",
    title: "心里有点乱",
    copy: "先把它说出来。",
  },
  {
    label: "职场减压",
    title: "工作消耗太多",
    copy: "先停一停。",
  },
  {
    label: "睡前陪伴",
    title: "今晚不想独处",
    copy: "安静待一会儿。",
  },
];

const pathSteps = [
  {
    code: "01",
    title: "看规则",
    copy: "确认年龄与服务边界",
  },
  {
    code: "02",
    title: "打开小程序",
    copy: "查看当前可用状态",
  },
  {
    code: "03",
    title: "留在平台内",
    copy: "预约、沟通与支持",
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
                面向年满 18 周岁的成年人。当前状态以微信小程序为准；身份核验通道完成前不开放新预约、支付或聊天。
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
          visual={<TheatreStage variant="listening" />}
        />
      </section>

      <section className="bubble-moments" aria-labelledby="moments-title">
        <Reveal as="header" className="bubble-heading">
          <p className="eyebrow">适合这样开始</p>
          <h2 id="moments-title">此刻想聊什么？</h2>
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
            <h2 id="path-title">三步开始。</h2>
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
          <PublicRuleLinks className="public-rule-links-on-pastel" />
        </Reveal>
      </section>

      <section className="bubble-channels" aria-labelledby="channels-title">
        <Reveal as="header" className="bubble-heading">
          <p className="eyebrow">服务入口</p>
          <h2 id="channels-title">选择入口。</h2>
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
              查看当前服务状态；身份核验通道完成前不开放新预约、支付或聊天。
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
            <p className="eyebrow">官网</p>
            <h3>公开信息</h3>
            <p>查看主体、备案与联系信息。</p>
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
            <p>私联、转账、举报与紧急风险。</p>
            <Link href="/safety" className="bubble-text-link">
              阅读安全说明 <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </article>
        </div>
      </section>
    </div>
  );
}
