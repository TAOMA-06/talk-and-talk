import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  HeartHandshake,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { Reveal, RevealItem, RevealStagger } from "./motion/Reveal";
import { PublicRuleLinks } from "./PublicRuleLinks";
import { TheatreStage } from "./motion/TheatreStage";

const pathways = [
  {
    eyebrow: "陪伴者协作",
    title: "陪伴者协作",
    copy: "说明场景与准备情况。",
    href: "/how-it-works",
    action: "查看服务规则",
    Icon: BriefcaseBusiness,
  },
  {
    eyebrow: "组织与社群",
    title: "组织与社群",
    copy: "先确认合同、隐私隔离与服务边界。",
    href: "/about",
    action: "查看公开信息",
    Icon: Building2,
  },
  {
    eyebrow: "媒体与行业交流",
    title: "媒体与行业交流",
    copy: "围绕线上陪伴与平台治理。",
    href: "/about",
    action: "关于 Talk&Talk",
    Icon: HeartHandshake,
  },
];

const principles = [
  "服务不等于医疗",
  "隐私先于协作",
  "履约先于扩展",
];

export default function PartnersScreen() {
  return (
    <div className="marketing-detail-page partners-page">
      <section className="marketing-detail-hero marketing-detail-hero-split partners-hero">
        <div className="marketing-detail-hero-copy">
          <p className="hero-brand"><span>合作与联系</span><i /> 边界清楚的合作</p>
          <h1>有价值的合作，先从边界清楚开始。</h1>
          <p>面向陪伴者、组织与媒体。先确认服务范围、隐私责任和履约价值。</p>
          <div className="marketing-detail-actions">
            <a href="mailto:hello@talkandtalk.app" className="button button-primary button-large">
              联系合作 <Mail size={18} aria-hidden="true" />
            </a>
            <Link href="/about" className="button button-secondary button-large">
              查看公开信息 <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <TheatreStage variant="partners" />
      </section>

      <section className="marketing-detail-section">
        <Reveal as="header" className="editorial-heading editorial-heading-wide">
          <p className="eyebrow">合作路径</p>
          <h2>选择合作入口。</h2>
        </Reveal>
        <RevealStagger className="partner-path-grid" stagger={0.1}>
          {pathways.map(({ Icon, eyebrow, title, copy, href, action }) => (
            <RevealItem key={eyebrow}>
              <article className="partner-path-card">
                <span><Icon size={22} aria-hidden="true" /></span>
                <p>{eyebrow}</p>
                <h3>{title}</h3>
                <div>{copy}</div>
                <Link href={href} className="text-link">{action} <ArrowRight size={16} aria-hidden="true" /></Link>
              </article>
            </RevealItem>
          ))}
        </RevealStagger>
      </section>

      <Reveal as="section" className="partner-principles">
        <div>
          <p className="eyebrow">合作原则</p>
          <h2>合作前确认三件事。</h2>
        </div>
        <ol>
          {principles.map((principle, index) => (
            <li key={principle}>
              <span>0{index + 1}</span>
              <p>{principle}</p>
            </li>
          ))}
        </ol>
      </Reveal>

      <Reveal as="section" className="partner-contact-card">
        <span><BadgeCheck size={25} aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">开始沟通</p>
          <h2>告诉我们你想一起解决什么。</h2>
          <p>邮件注明组织、场景与联系方式。</p>
        </div>
        <a href="mailto:hello@talkandtalk.app?subject=Talk%26Talk%20合作咨询" className="button button-primary">
          hello@talkandtalk.app <Mail size={17} aria-hidden="true" />
        </a>
      </Reveal>

      <Reveal as="section" className="partner-boundary-note">
        <ShieldCheck size={20} aria-hidden="true" />
        <p>不展示未核验的资质、规模或合作成果。</p>
      </Reveal>
      <PublicRuleLinks />
    </div>
  );
}
