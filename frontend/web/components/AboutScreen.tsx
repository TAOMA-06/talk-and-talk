"use client";

import { ArrowRight, FileCheck2, HeartHandshake, Mail, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";

import MiniprogramCta from "./MiniprogramCta";
import { Reveal } from "./motion/Reveal";
import { PageHeading } from "./ui";
import { hasVerifiedPublicDisclosure, publicDisclosure } from "../lib/public-disclosure";

export default function AboutScreen() {
  return (
    <div className="content-page about-page">
      <PageHeading
        eyebrow="关于我们"
        title="认真听你说，也认真守住边界"
        description="Talk&Talk 是女性友好的线上陪伴平台。发现、预约、支付、沟通与支持放在同一套可治理的产品结构里；服务入口以微信小程序页面状态为准。"
      />

      <Reveal as="section" className="about-section">
        <h2>我们相信什么</h2>
        <p>
          陪伴不是诊断，也不是说教。人们需要被听见，同时也需要清晰的边界：谁可以联系、钱怎么走、出了问题如何留痕。
          Talk&amp;Talk 选择把这些约束写进产品，而不是只写在口号里。
        </p>
      </Reveal>

      <Reveal as="section" className="about-section about-grid" delay={0.06}>
        <article>
          <span><HeartHandshake size={22} /></span>
          <h3>以陪伴为核心</h3>
          <p>不承诺治疗结果，不替代专业医疗或紧急救援。</p>
        </article>
        <article>
          <span><ShieldCheck size={22} /></span>
          <h3>信任有支持路径</h3>
          <p>资料审核、平台内沟通、订单与售后记录构成基本治理闭环。</p>
        </article>
        <article>
          <span><Smartphone size={22} /></span>
          <h3>发行面清晰</h3>
          <p>用户服务入口以微信小程序内的文字互动页面状态为准；本站用于官方说明、规则与公示。</p>
        </article>
      </Reveal>

      <Reveal as="section" className="about-section about-public-info" delay={0.07}>
        <div className="about-public-info-copy">
          <p className="eyebrow">公开信息</p>
          <h2>
            {hasVerifiedPublicDisclosure
              ? "公开信息应当可以被核对，而不只是被写出来。"
              : "一间负责任的公司，应该清楚说明什么已经具备，什么仍待核验。"}
          </h2>
          <p>
            {hasVerifiedPublicDisclosure
              ? "主体、投诉渠道和联系信息由发布配置驱动展示；小程序服务可用性仍以实际页面状态为准。"
              : "我们不会用未验证的规模、资质或经营成果填满官网。主体、备案及运营信息会在具备可公开证据后补充公示。"}
          </p>
        </div>
        <div className="about-public-info-grid">
          <article>
            <span><FileCheck2 size={20} /></span>
            <small>当前可说明</small>
            <strong>产品与规则</strong>
            <p>官网、服务路径、安全边界及联系渠道持续对外说明。</p>
          </article>
          <article>
            <span><ShieldCheck size={20} /></span>
            <small>{hasVerifiedPublicDisclosure ? "已公开核验" : "待公开核验"}</small>
            <strong>{hasVerifiedPublicDisclosure ? publicDisclosure.operatorName : "主体与备案"}</strong>
            <p>
              {hasVerifiedPublicDisclosure
                ? `${publicDisclosure.complaintChannel} · ${publicDisclosure.contactEmail} · ${publicDisclosure.contactPhone}`
                : "公司主体、备案和运营信息将在具备可公开证据后展示。"}
            </p>
            {publicDisclosure.icpRecord && (
              publicDisclosure.icpRecordUrl ? (
                <a href={publicDisclosure.icpRecordUrl} target="_blank" rel="noreferrer">{publicDisclosure.icpRecord}</a>
              ) : <small className="about-record">{publicDisclosure.icpRecord}</small>
            )}
          </article>
        </div>
      </Reveal>

      <Reveal as="section" className="about-section" delay={0.08}>
        <h2>产品边界</h2>
        <ul className="about-boundary-list">
          <li>服务对象为年满 18 周岁的成年人。</li>
          <li>平台内陪伴不等于心理咨询、精神科诊疗或危机干预。</li>
          <li>不鼓励交换私人联系方式、私下转账或线下邀约。</li>
          <li>遇紧急情况请立即联系当地紧急服务，而不是等待平台响应。</li>
        </ul>
        <Link href="/safety" className="text-link">
          阅读完整安全与支持说明 <ArrowRight size={16} />
        </Link>
      </Reveal>

      <Reveal as="section" className="about-section about-contact" delay={0.1}>
        <div>
          <h2>合作与联系</h2>
          <p>
            媒体、合作或陪伴者入驻相关事务，请通过邮件联系。我们不会在官网上展示未经核验的用户量或融资数据。
          </p>
          <div className="about-contact-actions">
            <a className="button button-secondary" href="mailto:hello@talkandtalk.app">
              <Mail size={17} aria-hidden="true" /> hello@talkandtalk.app
            </a>
            <Link href="/partners" className="text-link">
              查看合作路径 <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <MiniprogramCta variant="panel" secondaryHref="/how-it-works" secondaryLabel="了解服务路径" />
      </Reveal>
    </div>
  );
}
