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

const pathways = [
  {
    eyebrow: "陪伴者协作",
    title: "协作前，先把服务边界说清楚",
    copy: "如需讨论陪伴者协作，请先通过官方邮箱说明场景与准备情况；当前真实服务以微信小程序内的文字互动页面为准。",
    href: "/how-it-works",
    action: "了解当前服务路径",
    Icon: BriefcaseBusiness,
  },
  {
    eyebrow: "组织与社群",
    title: "从明确范围的关怀场景开始探索",
    copy: "面向员工关怀、女性社区与品牌公益等方向的合作，需要先确认独立合同、隐私隔离与服务边界。",
    href: "/about",
    action: "查看公开信息",
    Icon: Building2,
  },
  {
    eyebrow: "媒体与行业交流",
    title: "讨论陪伴、信任和负责任的平台设计",
    copy: "我们欢迎围绕线上陪伴、产品治理和女性友好体验的交流，不使用未经核验的规模或增长叙事。",
    href: "/about",
    action: "了解我们相信什么",
    Icon: HeartHandshake,
  },
];

const principles = [
  "先明确服务范围，不将陪伴描述为医疗或治疗。",
  "先设计隐私和数据边界，再讨论协作方式。",
  "先验证用户与履约价值，再讨论规模化扩展。",
];

export default function PartnersScreen() {
  return (
    <div className="marketing-detail-page partners-page">
      <section className="marketing-detail-hero marketing-detail-hero-split partners-hero">
        <div className="marketing-detail-hero-copy">
          <p className="hero-brand"><span>合作与联系</span><i /> 边界清楚的合作</p>
          <h1>有价值的合作，先从边界清楚开始。</h1>
          <p>
            Talk&amp;Talk 希望把线上陪伴做成可持续、可治理的服务体验。
            我们更重视明确的服务范围、隐私隔离与真实的履约价值，不使用未经核验的规模叙事。
          </p>
          <div className="marketing-detail-actions">
            <a href="mailto:hello@talkandtalk.app" className="button button-primary button-large">
              联系合作 <Mail size={18} aria-hidden="true" />
            </a>
            <Link href="/about" className="button button-secondary button-large">
              查看公开信息 <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <aside className="partner-hero-frame" aria-label="合作判断框架">
          <div className="partner-hero-frame-head">
            <span>合作判断框架</span>
            <BadgeCheck size={18} aria-hidden="true" />
          </div>
          <div className="partner-hero-principle partner-hero-principle-main">
            <span>01</span>
            <strong>先确认服务边界</strong>
            <small>不将陪伴包装成医疗或治疗</small>
          </div>
          <div className="partner-hero-principles">
            <div><span>02</span><strong>隐私责任</strong><small>先做隔离，再谈协作</small></div>
            <div><span>03</span><strong>履约价值</strong><small>先验证，再做扩展</small></div>
          </div>
          <p>无虚构规模、客户或合作成果</p>
        </aside>
      </section>

      <section className="marketing-detail-section">
        <Reveal as="header" className="editorial-heading editorial-heading-wide">
          <p className="eyebrow">合作路径</p>
          <h2>不同角色，应该从不同的下一步开始。</h2>
          <p>不把用户、陪伴者和机构合作混为一个入口，让每一种关系都有准确的说明和行动。</p>
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
          <h2>比起讲得很大，我们更在意把每一件事讲清楚。</h2>
          <p>合作前的判断会围绕真实需求、风险边界、隐私责任和长期履约展开。</p>
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
          <p>请在邮件中说明合作类型、所在组织、希望讨论的场景以及方便联系的方式。我们会基于服务边界与实际准备度回复。</p>
        </div>
        <a href="mailto:hello@talkandtalk.app?subject=Talk%26Talk%20合作咨询" className="button button-primary">
          hello@talkandtalk.app <Mail size={17} aria-hidden="true" />
        </a>
      </Reveal>

      <Reveal as="section" className="partner-boundary-note">
        <ShieldCheck size={20} aria-hidden="true" />
        <p>本站仅描述已实现的产品能力与明确标注的探索方向，不将尚未获得的经营资格、规模数据或合作成果包装为既成事实。</p>
      </Reveal>
    </div>
  );
}
