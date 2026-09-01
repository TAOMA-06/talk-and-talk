import {
  ArrowRight,
  CalendarCheck2,
  MessageCircleHeart,
  ShieldCheck,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import MiniprogramCta from "./MiniprogramCta";
import { PublicRuleLinks } from "./PublicRuleLinks";
import { Reveal, RevealItem, RevealStagger } from "./motion/Reveal";
import { TheatreStage } from "./motion/TheatreStage";

const steps = [
  {
    code: "01",
    label: "发现与选择",
    title: "查看资料与可约时间",
    copy: "确认对象、方式与时间。",
    Icon: UserRoundCheck,
  },
  {
    code: "02",
    label: "预约与确认",
    title: "提交预约",
    copy: "等待陪伴者确认。",
    Icon: CalendarCheck2,
  },
  {
    code: "03",
    label: "交易与履约",
    title: "按订单履约",
    copy: "金额与退款以订单和微信支付结果为准。",
    Icon: WalletCards,
  },
  {
    code: "04",
    label: "沟通与支持",
    title: "平台内沟通",
    copy: "会话、举报与售后留在平台内。",
    Icon: MessageCircleHeart,
  },
];

export default function HowItWorksScreen() {
  return (
    <div className="marketing-detail-page how-it-works-page">
      <section className="marketing-detail-hero marketing-detail-hero-split how-it-works-hero">
        <div className="marketing-detail-hero-copy">
          <p className="hero-brand"><span>产品如何运作</span><i /> 服务路径说明</p>
          <h1>把一次认真连接，放进一条清楚的服务路径。</h1>
          <p>发现、预约、支付、沟通与支持沿同一订单路径发生；当前状态以小程序为准。</p>
          <div className="marketing-detail-actions">
            <MiniprogramCta
              variant="inline"
              secondaryHref="/safety"
              secondaryLabel="查看安全与支持"
            />
          </div>
        </div>
        <TheatreStage variant="path" />
      </section>

      <section className="marketing-detail-section journey-explainer">
        <Reveal as="header" className="editorial-heading editorial-heading-wide">
          <p className="eyebrow">可信陪伴链</p>
          <h2>四步完成连接。</h2>
        </Reveal>
        <RevealStagger className="journey-explainer-grid" stagger={0.1}>
          {steps.map(({ Icon, code, label, title, copy }) => (
            <RevealItem key={code}>
              <article className="journey-explainer-card">
                <div>
                  <span>{code}</span>
                  <Icon size={21} aria-hidden="true" />
                </div>
                <small>{label}</small>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            </RevealItem>
          ))}
        </RevealStagger>
      </section>

      <Reveal as="section" className="marketing-boundary-callout">
        <span><ShieldCheck size={24} aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">规则是体验的一部分</p>
          <h2>不要私联、私下转账或线下邀约。</h2>
          <p>重要过程留在平台内。</p>
        </div>
        <Link href="/safety" className="text-link">阅读完整说明 <ArrowRight size={16} aria-hidden="true" /></Link>
      </Reveal>
      <PublicRuleLinks />
    </div>
  );
}
