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
import { PageHeading } from "./ui";

export default function SafetyScreen() {
  return (
    <div className="content-page safety-page">
      <PageHeading
        eyebrow="安全与支持"
        title="安心不是一句承诺，而是一组清楚的边界"
        description="了解资料核验、平台内沟通、举报复核和订单售后各自能做什么。"
      />

      <section className="safety-hero-card">
        <span><ShieldCheck size={34} /></span>
        <div>
          <h2>先保护自己，再继续互动</h2>
          <p>任何让你不适、被施压或被诱导离开平台的互动，都可以立即停止。</p>
        </div>
        <Link href="/demo" className="button button-secondary">查看网页产品演示 <ArrowRight size={16} /></Link>
      </section>

      <section className="safety-grid">
        <article><span><LockKeyhole size={23} /></span><h3>只在平台内沟通</h3><p>不要交换手机号、社交账号或收款方式，不接受线下见面和私下交易。</p></article>
        <article><span><MessageCircleWarning size={23} /></span><h3>会话有安全出口</h3><p>可以静音、停止互动、举报具体消息，或从订单入口提交售后问题。</p></article>
        <article><span><FileWarning size={23} /></span><h3>举报是线索，不是结论</h3><p>举报回执只表示平台已收到，不代表处罚、处理时限或风险已经解除。</p></article>
        <article><span><HeartHandshake size={23} /></span><h3>陪伴不是治疗</h3><p>平台不提供医疗诊断、心理治疗、紧急救援、法律或投资建议。</p></article>
      </section>

      <section className="boundary-section">
        <div className="boundary-copy">
          <p className="eyebrow">遇到这些情况，请先停止互动</p>
          <h2>越界不需要被合理化</h2>
          <p>无论对方自称出于关心、专业判断或特殊需要，以下行为都不应发生。</p>
        </div>
        <div className="boundary-list">
          <div><Ban size={19} /><span><strong>要求私联或线下见面</strong><small>包括添加社交账号、交换电话或到私人场所见面</small></span></div>
          <div><Ban size={19} /><span><strong>要求私下转账或购买外部服务</strong><small>所有费用与退款都应留在平台订单中</small></span></div>
          <div><Ban size={19} /><span><strong>骚扰、羞辱、威胁或情感操控</strong><small>你可以停止互动，不必先说服对方</small></span></div>
          <div><Ban size={19} /><span><strong>承诺治疗效果或替代专业帮助</strong><small>“已认证”不等于医疗、咨询或其他专业资质</small></span></div>
        </div>
      </section>

      <section className="urgent-card">
        <span><Siren size={27} /></span>
        <div>
          <h2>如果存在即时人身危险或急性医疗风险</h2>
          <p>请停止使用平台聊天寻求救助，立即联系你所在地区可用的紧急服务或可信赖的现实支持者。Talk&amp;Talk 不能提供紧急响应。</p>
        </div>
      </section>

      <section className="help-section">
        <div>
          <p className="eyebrow">选择正确的入口</p>
          <h2>不同问题，走不同路径</h2>
        </div>
        <div className="help-cards">
          <Link href="/how-it-works"><MessageCircleWarning size={21} /><span><strong>聊天或互动问题</strong><small>服务中的支持入口以微信小程序对应会话页面为准</small></span><ArrowRight size={17} /></Link>
          <Link href="/how-it-works"><CircleHelp size={21} /><span><strong>订单、履约或退款问题</strong><small>服务中的支持入口以微信小程序对应订单页面为准</small></span><ArrowRight size={17} /></Link>
          <a href={TERMS_URL} target="_blank" rel="noreferrer"><FileWarning size={21} /><span><strong>小程序平台规则</strong><small>查看服务、交易、内容与争议处理边界</small></span><ArrowRight size={17} /></a>
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer"><LockKeyhole size={21} /><span><strong>小程序个人信息权利</strong><small>查看查询、更正、删除、撤回与投诉方式</small></span><ArrowRight size={17} /></a>
        </div>
      </section>
    </div>
  );
}
