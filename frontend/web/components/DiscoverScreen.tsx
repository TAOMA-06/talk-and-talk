"use client";

import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarCheck2,
  CheckCircle2,
  HeartHandshake,
  LockKeyhole,
  MessageCircleHeart,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TimerReset,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { requestApi } from "../lib/api-client";
import { previewCompanions } from "../lib/fixtures";
import { availabilityLabel, currency, pickList, readableError } from "../lib/format";
import type { Companion } from "../lib/types";
import { CompanionCard, EmptyState, LoadingState } from "./ui";

const topics = ["全部", "情绪倾听", "职场减压", "睡前陪伴", "成长困惑"];
const modes = [
  { value: "all", label: "全部方式" },
  { value: "text", label: "文字陪伴" },
  { value: "voice", label: "语音陪伴" },
];

export default function DiscoverScreen() {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("全部");
  const [mode, setMode] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let active = true;
    requestApi<{ items: Companion[] }>("/companions?page=1&pageSize=24", { cache: "no-store" })
      .then((data) => {
        if (!active) return;
        setCompanions(pickList<Companion>(data));
        setPreview(false);
      })
      .catch((reason) => {
        if (!active) return;
        setCompanions(previewCompanions);
        setPreview(true);
        setError(readableError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return companions.filter((companion) => {
      const text = [
        companion.name,
        companion.role,
        companion.bio,
        ...(companion.tags || []),
        ...(companion.specialties || []),
      ].join(" ").toLowerCase();
      const topicMatches =
        topic === "全部" ||
        companion.tags?.includes(topic) ||
        companion.specialties?.includes(topic);
      const modeMatches =
        mode === "all" || companion.catalog?.deliveryModes?.includes(mode as "text" | "voice");
      return (!normalized || text.includes(normalized)) && topicMatches && modeMatches;
    });
  }, [companions, mode, query, topic]);

  const clearFilters = () => {
    setQuery("");
    setTopic("全部");
    setMode("all");
  };

  const isFiltering = Boolean(query.trim()) || topic !== "全部" || mode !== "all";
  const spotlight = companions[0] || previewCompanions[0];

  const chooseTopic = (value: string) => {
    setTopic(value);
    document.getElementById("companions")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="discover-page">
      <section className="marketplace-hero" aria-labelledby="hero-title">
        <div className="marketplace-hero-copy">
          <p className="hero-brand">Talk&amp;Talk</p>
          <h1 id="hero-title">
            想说的话有人听，
            <span>安心的边界也一直在。</span>
          </h1>
          <p className="hero-lead">
            按主题、服务方式与时间找到合适的陪伴者。预约、支付、沟通和支持都留在平台内。正式履约以微信小程序为准。
          </p>
          <div className="hero-actions">
            <a href="#companions" className="button button-primary button-large">
              开始寻找陪伴者 <ArrowRight size={18} />
            </a>
            <Link href="/" className="button button-secondary button-large">
              返回官网首页
            </Link>
          </div>
        </div>

        <div className="hero-product-stage" aria-label="Talk&Talk 产品体验示例">
          <article className="hero-companion-preview">
            <div className="preview-card-topline">
              <span className={preview ? "live-label demo" : "live-label"}>
                <i />
                {loading ? "正在连接服务" : preview ? "交互演示资料" : "正式服务资料"}
              </span>
              <span className="soft-label">18+</span>
            </div>
            <div className="preview-profile">
              <span className="preview-avatar">{spotlight.initials || spotlight.name.slice(0, 2)}</span>
              <div>
                <div className="preview-name">
                  <strong>{spotlight.name}</strong>
                  <BadgeCheck size={17} />
                </div>
                <p>{spotlight.role}</p>
              </div>
            </div>
            <blockquote>“{spotlight.bio}”</blockquote>
            <div className="preview-service-row">
              {(spotlight.specialties || spotlight.tags || []).slice(0, 2).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className="preview-booking-row">
              <div>
                <small>服务起价</small>
                <strong>{currency(spotlight.catalog?.startingPriceCents)}</strong>
              </div>
              <div>
                <small>最近可约</small>
                <strong>{availabilityLabel(spotlight.availability)}</strong>
              </div>
              <span className="preview-arrow"><ArrowRight size={18} /></span>
            </div>
          </article>
          <div className="hero-flow-card">
            <span><CheckCircle2 size={16} /> 资料已审核</span>
            <i />
            <span><CalendarCheck2 size={16} /> 时段锁定</span>
            <i />
            <span><WalletCards size={16} /> 平台内交易</span>
          </div>
        </div>
      </section>

      <section className="trust-rail" aria-label="产品保障">
        <article>
          <span><UserRoundCheck size={20} /></span>
          <div><strong>人工资料审核</strong><small>公开前经过平台流程</small></div>
        </article>
        <article>
          <span><LockKeyhole size={20} /></span>
          <div><strong>平台内沟通</strong><small>聊天与订单形成记录</small></div>
        </article>
        <article>
          <span><ShieldCheck size={20} /></span>
          <div><strong>举报与售后</strong><small>边界写进产品结构</small></div>
        </article>
        <article>
          <span><HeartHandshake size={20} /></span>
          <div><strong>以陪伴为核心</strong><small>不诊断、不说教</small></div>
        </article>
      </section>

      <section className="moment-section">
        <header className="editorial-heading">
          <p className="eyebrow">从你此刻的需要出发</p>
          <h2>不用先想清楚，也可以先找个人说说</h2>
          <p>主题只是帮助匹配的入口，不会替你定义正在经历什么。</p>
        </header>
        <div className="moment-grid">
          <button type="button" onClick={() => chooseTopic("情绪倾听")}>
            <span>01</span><div><strong>心里有点乱</strong><small>情绪倾听</small></div><ArrowRight size={17} />
          </button>
          <button type="button" onClick={() => chooseTopic("职场减压")}>
            <span>02</span><div><strong>工作消耗太多</strong><small>职场减压</small></div><ArrowRight size={17} />
          </button>
          <button type="button" onClick={() => chooseTopic("睡前陪伴")}>
            <span>03</span><div><strong>今晚不想独处</strong><small>睡前陪伴</small></div><ArrowRight size={17} />
          </button>
          <button type="button" onClick={() => chooseTopic("成长困惑")}>
            <span>04</span><div><strong>站在人生路口</strong><small>成长困惑</small></div><ArrowRight size={17} />
          </button>
        </div>
      </section>

      <section className="discovery-section" id="companions">
        <header className="section-heading marketplace-heading">
          <div>
            <p className="eyebrow">精选陪伴者</p>
            <h2>找到与你此刻更合拍的人</h2>
            <p>每次下单前，系统都会重新核对服务、价格、时间和剩余容量。</p>
          </div>
          <button
            type="button"
            className="filter-toggle"
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal size={17} />
            筛选
          </button>
        </header>

        <div className={filtersOpen ? "search-panel open" : "search-panel"} role="search">
          <label className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名称、角色、服务或标签"
              maxLength={40}
            />
          </label>
          <div className="filter-block">
            <span>主题</span>
            <div className="chip-row">
              {topics.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={topic === value ? "filter-chip selected" : "filter-chip"}
                  onClick={() => setTopic(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-block">
            <span>服务方式</span>
            <div className="chip-row">
              {modes.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={mode === item.value ? "filter-chip selected" : "filter-chip"}
                  onClick={() => setMode(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {isFiltering && (
            <div className="filter-summary">
              <span>已按当前条件筛选</span>
              <button type="button" className="text-button" onClick={clearFilters}>
                清除条件
              </button>
            </div>
          )}
        </div>

        {preview && (
          <div className="preview-notice" role="status">
            <span className="preview-dot" />
            <div>
              <strong>当前为产品交互演示资料</strong>
              <span>不代表真实供给或经营数据，不能下单；正式 API 恢复后会自动切换到已发布资料。</span>
            </div>
            <span className="preview-reason" title={error}>演示模式</span>
          </div>
        )}

        {!loading && filtered.length > 0 && !isFiltering && (
          <p className="recommendation-note">根据公开资料与当前服务状态展示；详情页和下单会再次校验。</p>
        )}

        {loading ? (
          <LoadingState label="正在寻找当前可约的陪伴者…" />
        ) : filtered.length ? (
          <div className="companion-grid discover-companion-grid">
            {filtered.map((companion) => (
              <CompanionCard key={companion.id} companion={companion} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="暂时没有符合条件的陪伴者"
            description="换一个主题或服务方式看看，真实可约时间会持续更新。"
            action={
              <button type="button" className="button button-secondary" onClick={clearFilters}>
                清除筛选
              </button>
            }
          />
        )}
      </section>

      <section className="how-section commercial-how">
        <div className="how-intro">
          <p className="eyebrow">一条可解释的服务链路</p>
          <h2>每一步都简单，每一步都有凭据</h2>
          <p>体验像成熟的服务市场，规则则从发现一直延伸到售后。</p>
        </div>
        <div className="how-steps">
          <article>
            <span>01</span>
            <h3>了解与选择</h3>
            <p>公开资料、擅长主题、服务商品和可约时间集中呈现。</p>
          </article>
          <article>
            <span>02</span>
            <h3>预约与确认</h3>
            <p>用户发起预约，陪伴者在工作台确认，服务端锁定供给。</p>
          </article>
          <article>
            <span>03</span>
            <h3>履约与支持</h3>
            <p>支付、平台内沟通、状态流转、举报和退款都有记录。</p>
          </article>
        </div>
      </section>

      <section className="dual-role-section">
        <div className="dual-role-copy">
          <p className="eyebrow">用户端 × 陪伴者工作台</p>
          <h2>同一个账号里的两种视角</h2>
          <p>
            已审核陪伴者也可以像普通用户一样发现服务；切换到工作台后，再管理自己的商品、时段、预约与履约。
          </p>
          <ul>
            <li><CheckCircle2 size={17} /> 用户体验与经营入口共享导航和账号</li>
            <li><CheckCircle2 size={17} /> 陪伴者只管理属于自己的私有数据</li>
            <li><CheckCircle2 size={17} /> 订单状态在用户端、工作台与消息中同步</li>
          </ul>
          <div className="dual-role-actions">
            <Link href="/workbench" className="button button-primary">
              进入陪伴者工作台 <BriefcaseBusiness size={17} />
            </Link>
            <Link href="/business" className="text-link">
              查看平台闭环 <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div className="workbench-showcase" aria-label="陪伴者工作台界面示意">
          <div className="showcase-window-bar">
            <span /><span /><span />
            <small>同一账号 · 陪伴者视角</small>
          </div>
          <div className="showcase-switcher">
            <span><Sparkles size={15} /> 用户端</span>
            <strong><BriefcaseBusiness size={15} /> 工作台</strong>
          </div>
          <div className="showcase-heading">
            <div><small>今日工作台</small><strong>把服务安排得更从容</strong></div>
            <span>仅本人可见</span>
          </div>
          <div className="showcase-capabilities">
            <article><span><CalendarCheck2 size={19} /></span><strong>预约履约</strong><small>确认 · 开始 · 完成</small></article>
            <article><span><WalletCards size={19} /></span><strong>服务商品</strong><small>方式 · 时长 · 价格</small></article>
            <article><span><TimerReset size={19} /></span><strong>可约时间</strong><small>时段 · 容量 · 上下架</small></article>
            <article><span><MessageCircleHeart size={19} /></span><strong>平台消息</strong><small>订单会话 · 安全边界</small></article>
          </div>
        </div>
      </section>

      <section className="safety-summary-section">
        <header className="editorial-heading centered">
          <p className="eyebrow">信任不是一句口号</p>
          <h2>把边界放在产品结构里</h2>
          <p>从资料公开范围到支付、会话和售后，关键动作都有平台规则承接。</p>
        </header>
        <div className="safety-summary-grid">
          <article>
            <span><UserRoundCheck size={22} /></span>
            <h3>供给先审核</h3>
            <p>首发阶段不开放无审核自助入驻，资料和服务通过平台流程后才可公开。</p>
          </article>
          <article>
            <span><ShieldCheck size={22} /></span>
            <h3>内容有治理</h3>
            <p>敏感内容由规则与审核流程承接，用户可屏蔽、举报并保留订单证据。</p>
          </article>
          <article>
            <span><WalletCards size={22} /></span>
            <h3>交易可追踪</h3>
            <p>创建、确认、支付、服务、取消和退款由后端状态机统一管理。</p>
          </article>
        </div>
        <Link href="/safety" className="button button-secondary">
          查看安全与支持说明 <ArrowRight size={17} />
        </Link>
      </section>
    </div>
  );
}
