"use client";

import { ArrowRight, HeartHandshake, Mail, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";

import { PublicRuleLinks } from "./PublicRuleLinks";
import { Reveal } from "./motion/Reveal";
import { TheatreStage } from "./motion/TheatreStage";
import { PageHeading } from "./ui";
import { hasVerifiedPublicDisclosure, publicDisclosure } from "../lib/public-disclosure";

export default function AboutScreen() {
  return (
    <div className="content-page about-page">
      <section className="about-theatre-hero" aria-label="关于 Talk&Talk">
        <div>
          <PageHeading
            eyebrow="关于我们"
            title="认真听你说，也认真守住边界"
            description="女性友好的线上陪伴平台。当前服务状态以微信小程序为准。"
          />
        </div>
        <TheatreStage variant="worktable" />
      </section>

      <Reveal as="section" className="about-section about-grid" delay={0.06}>
        <article>
          <span><HeartHandshake size={22} /></span>
          <h3>陪伴，不是治疗</h3>
          <p>不承诺疗效，不替代医疗或急救。</p>
        </article>
        <article>
          <span><ShieldCheck size={22} /></span>
          <h3>重要过程留在平台内</h3>
          <p>预约、沟通、订单与售后可回看。</p>
        </article>
      </Reveal>

      <Reveal as="section" className="about-section about-public-info" delay={0.07}>
        <div className="about-public-info-copy">
          <p className="eyebrow">公开信息</p>
          <h2>
            {hasVerifiedPublicDisclosure
              ? "已核验的主体与联系信息"
              : "未核验的信息不展示"}
          </h2>
          <p>
            {hasVerifiedPublicDisclosure
              ? "以下信息由发布配置提供。"
              : "主体、备案与运营信息待证据具备后公示。"}
          </p>
        </div>
        <div className="about-public-info-grid">
          <article>
            <span><Smartphone size={20} /></span>
            <small>当前状态</small>
            <strong>身份核验通道待完成</strong>
            <p>新预约、支付与聊天暂不开放。</p>
          </article>
          <article>
            <span><ShieldCheck size={20} /></span>
            <small>{hasVerifiedPublicDisclosure ? "已公开核验" : "待公开核验"}</small>
            <strong>{hasVerifiedPublicDisclosure ? publicDisclosure.operatorName : "主体与备案"}</strong>
            <p>
              {hasVerifiedPublicDisclosure
                ? `${publicDisclosure.complaintChannel} · ${publicDisclosure.contactEmail} · ${publicDisclosure.contactPhone}`
                : "待具备可公开证据后展示。"}
            </p>
            {publicDisclosure.icpRecord && (
              publicDisclosure.icpRecordUrl ? (
                <a href={publicDisclosure.icpRecordUrl} target="_blank" rel="noreferrer">{publicDisclosure.icpRecord}</a>
              ) : <small className="about-record">{publicDisclosure.icpRecord}</small>
            )}
          </article>
        </div>
      </Reveal>

      <PublicRuleLinks />

      <Reveal as="section" className="about-section about-contact" delay={0.1}>
        <div>
          <h2>联系 Talk&amp;Talk</h2>
          <p>合作、媒体或陪伴者事务。</p>
          <div className="about-contact-actions">
            <a className="button button-secondary" href="mailto:hello@talkandtalk.app">
              <Mail size={17} aria-hidden="true" /> hello@talkandtalk.app
            </a>
            <Link href="/partners" className="text-link">
              查看合作路径 <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
