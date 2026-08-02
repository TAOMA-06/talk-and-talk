"use client";

import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  MessageCircleHeart,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { motionEase, usePrefersReducedMotion } from "./motion/usePrefersReducedMotion";

export type DemoStageId = "discover" | "booking" | "delivery" | "support";

type DemoStage = {
  id: DemoStageId;
  number: string;
  label: string;
  eyebrow: string;
  title: string;
  copy: string;
  userRows: Array<[string, string]>;
  companionRows: Array<[string, string]>;
  sharedState: {
    user: string;
    platform: string;
    companion: string;
  };
  status: string;
  Icon: typeof Eye;
};

const demoStages: DemoStage[] = [
  {
    id: "discover",
    number: "01",
    label: "发现",
    eyebrow: "公开资料与服务方式",
    title: "先知道自己在选择什么。",
    copy: "用主题、服务方式和可约信息建立第一层判断，而不是把连接交给模糊的私下沟通。",
    userRows: [["服务主题", "情绪倾听 · 睡前陪伴"], ["服务方式", "语音 / 文字"], ["可约状态", "示例：今晚 20:30"]],
    companionRows: [["公开资料", "展示规则已配置"], ["服务商品", "方式与时长清楚"], ["可约时段", "由工作台维护"]],
    sharedState: {
      user: "浏览公开资料",
      platform: "展示规则生效",
      companion: "资料与服务已发布",
    },
    status: "公开浏览 · 脱敏示例",
    Icon: Eye,
  },
  {
    id: "booking",
    number: "02",
    label: "约定",
    eyebrow: "时间、价格与确认",
    title: "把一次约定写进同一条状态。",
    copy: "用户看到的时间和价格，与陪伴者可确认的服务容量保持在同一份订单语境里。",
    userRows: [["服务时段", "示例：今天 20:30"], ["订单状态", "等待确认"], ["订单说明", "取消与退款规则可见"]],
    companionRows: [["预约请求", "一条待确认请求"], ["时段容量", "同步占用状态"], ["确认动作", "接受 / 拒绝有记录"]],
    sharedState: {
      user: "提交预约意向",
      platform: "等待确认",
      companion: "确认时段容量",
    },
    status: "订单状态 · 脱敏示例",
    Icon: CalendarCheck2,
  },
  {
    id: "delivery",
    number: "03",
    label: "履约",
    eyebrow: "订单、会话与工作台",
    title: "让交易、沟通与履约能彼此对上。",
    copy: "订单不是一次跳转；它把服务进度、平台内沟通和工作台中的履约信息连接在一起。",
    userRows: [["订单状态", "服务进行中"], ["会话入口", "平台内服务会话"], ["支付记录", "与订单关联"]],
    companionRows: [["今日安排", "一条服务待履约"], ["服务进度", "可记录关键状态"], ["订单记录", "收入与履约同步"]],
    sharedState: {
      user: "进入平台内会话",
      platform: "订单履约中",
      companion: "更新履约进度",
    },
    status: "服务履约 · 脱敏示例",
    Icon: WalletCards,
  },
  {
    id: "support",
    number: "04",
    label: "支持",
    eyebrow: "问题有可回看的入口",
    title: "遇到问题，不必只靠口头解释。",
    copy: "订单、举报与售后支持沿着同一条产品路径回看，让需要协助的时刻也有清楚的下一步。",
    userRows: [["问题类型", "示例：订单与服务"], ["支持入口", "从对应订单发起"], ["处理记录", "状态可回看"]],
    companionRows: [["履约证据", "关联订单状态"], ["售后协作", "依规则处理"], ["平台治理", "有明确支持入口"]],
    sharedState: {
      user: "从订单发起支持",
      platform: "问题进入受理",
      companion: "关联履约记录",
    },
    status: "支持链路 · 脱敏示例",
    Icon: ShieldCheck,
  },
];

function findDemoStage(stageId: string | null) {
  return demoStages.find((stage) => stage.id === stageId);
}

export default function DemoExperience({ initialStageId }: { initialStageId?: DemoStageId }) {
  const [activeStageId, setActiveStageId] = useState<DemoStageId>(initialStageId ?? demoStages[0].id);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const reducedMotion = usePrefersReducedMotion();
  const tablistId = useId();
  const panelId = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, demoStages.findIndex((stage) => stage.id === activeStageId));
  const activeStage = demoStages[activeIndex] ?? demoStages[0];
  const ActiveIcon = activeStage.Icon;

  useEffect(() => {
    const syncStageFromLocation = () => {
      const requestedStage = findDemoStage(new URLSearchParams(window.location.search).get("stage"));
      if (requestedStage) setActiveStageId(requestedStage.id);
    };

    syncStageFromLocation();
    window.addEventListener("popstate", syncStageFromLocation);
    return () => window.removeEventListener("popstate", syncStageFromLocation);
  }, []);

  useEffect(() => {
    const tab = tabs.current[activeIndex];
    const tabList = tab?.parentElement;
    if (!tab || !tabList) return;

    const targetLeft = Math.max(0, tab.offsetLeft - (tabList.clientWidth - tab.offsetWidth) / 2);
    tabList.scrollTo({ left: targetLeft, behavior: reducedMotion ? "auto" : "smooth" });
  }, [activeIndex, reducedMotion]);

  const selectStage = (index: number, focus = false) => {
    const nextStage = demoStages[index];
    if (!nextStage) return;
    setDirection(index >= activeIndex ? 1 : -1);
    setActiveStageId(nextStage.id);
    setHasInteracted(true);
    const params = new URLSearchParams(window.location.search);
    if (nextStage.id === demoStages[0].id) {
      params.delete("stage");
    } else {
      params.set("stage", nextStage.id);
    }
    const search = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    if (focus) tabs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % demoStages.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + demoStages.length) % demoStages.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = demoStages.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectStage(nextIndex, true);
  };

  return (
    <div className="marketing-detail-page demo-page">
      <section className="demo-hero">
        <div>
          <p className="hero-brand"><span>网页产品演示</span><i /> Read-only product tour</p>
          <h1>不用登录，也能走完一条可信服务路径。</h1>
          <p>
            这是一个脱敏的产品结构演示：不创建账号、不提交信息、不发起订单。它用于说明 Talk&amp;Talk 如何把用户体验、陪伴者履约与平台支持放进同一套系统。
          </p>
          <div className="marketing-detail-actions">
            <Link href="#demo-route" className="button button-primary button-large">
              开始查看演示 <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link href="/partners" className="button button-secondary button-large">
              讨论合作方式
            </Link>
          </div>
        </div>
        <aside className="demo-hero-card" aria-label="演示边界">
          <span><ClipboardCheck size={19} aria-hidden="true" /> 只读演示</span>
          <strong>所有姓名、时间、状态和服务内容均为脱敏示例。</strong>
          <p>真实服务入口、可用状态与履约规则以微信小程序实际页面为准。</p>
          <div><CheckCircle2 size={16} aria-hidden="true" /> 无需账号即可查看</div>
        </aside>
      </section>

      <section id="demo-route" className="demo-route-section" aria-labelledby="demo-route-title">
        <header className="editorial-heading editorial-heading-wide">
          <p className="eyebrow">一条双边产品链路</p>
          <h2 id="demo-route-title">每一步都让双方看见相同的关键状态。</h2>
          <p>切换四个阶段，查看用户侧、陪伴者侧和平台支持如何在同一条服务路径中衔接。</p>
        </header>

        <div className="demo-route-shell">
          <div className="demo-stage-tabs" role="tablist" aria-label="产品演示阶段">
            {demoStages.map((stage, index) => {
              const Icon = stage.Icon;
              const active = stage.id === activeStage.id;
              return (
                <button
                  key={stage.id}
                  ref={(element) => {
                    tabs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`${tablistId}-${stage.id}`}
                  aria-controls={panelId}
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  className={active ? "active" : undefined}
                  onClick={() => selectStage(index)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <span>{stage.number}</span>
                  <Icon size={17} aria-hidden="true" />
                  <strong>{stage.label}</strong>
                </button>
              );
            })}
          </div>

          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={`${tablistId}-${activeStage.id}`}
            aria-live="polite"
            aria-atomic="true"
            className="demo-stage-panel"
            tabIndex={0}
          >
            <motion.div
              key={activeStage.id}
              className="demo-stage-content"
              initial={hasInteracted && !reducedMotion ? { opacity: 0, x: 18 * direction, y: 4 } : false}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.34, ease: motionEase }}
            >
              <div className="demo-stage-heading">
                <span className="demo-stage-icon"><ActiveIcon size={22} aria-hidden="true" /></span>
                <div>
                  <p>{activeStage.eyebrow}</p>
                  <h3>{activeStage.title}</h3>
                </div>
                <span className="demo-stage-status">{activeStage.status}</span>
              </div>
              <p className="demo-stage-copy">{activeStage.copy}</p>
              <motion.section
                key={`bridge-${activeStage.id}`}
                className="demo-status-bridge"
                aria-label="这一阶段的共同状态"
                initial={hasInteracted && !reducedMotion ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.32, ease: motionEase }}
              >
                <article className="demo-bridge-party demo-bridge-user">
                  <small>用户动作</small>
                  <strong>{activeStage.sharedState.user}</strong>
                </article>
                <div className="demo-bridge-connector" aria-hidden="true">
                  <motion.span
                    key={`${activeStage.id}-user-signal`}
                    initial={hasInteracted && !reducedMotion ? { opacity: 0, scaleX: 0 } : false}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ duration: reducedMotion ? 0 : 0.26, delay: reducedMotion ? 0 : 0.08, ease: motionEase }}
                  />
                  <ArrowRight size={15} />
                </div>
                <article className="demo-bridge-party demo-bridge-platform">
                  <small>平台共同状态</small>
                  <strong>{activeStage.sharedState.platform}</strong>
                </article>
                <div className="demo-bridge-connector" aria-hidden="true">
                  <motion.span
                    key={`${activeStage.id}-companion-signal`}
                    initial={hasInteracted && !reducedMotion ? { opacity: 0, scaleX: 0 } : false}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ duration: reducedMotion ? 0 : 0.26, delay: reducedMotion ? 0 : 0.16, ease: motionEase }}
                  />
                  <ArrowRight size={15} />
                </div>
                <article className="demo-bridge-party demo-bridge-companion">
                  <small>陪伴者工作台</small>
                  <strong>{activeStage.sharedState.companion}</strong>
                </article>
              </motion.section>
              <div className="demo-desk-grid">
                <article>
                  <header><span>用户侧</span><MessageCircleHeart size={17} aria-hidden="true" /></header>
                  <dl>
                    {activeStage.userRows.map(([term, value]) => (
                      <div key={term}><dt>{term}</dt><dd>{value}</dd></div>
                    ))}
                  </dl>
                </article>
                <article>
                  <header><span>陪伴者工作台</span><CalendarCheck2 size={17} aria-hidden="true" /></header>
                  <dl>
                    {activeStage.companionRows.map(([term, value]) => (
                      <div key={term}><dt>{term}</dt><dd>{value}</dd></div>
                    ))}
                  </dl>
                </article>
              </div>
              <div className="demo-stage-rule">
                <ShieldCheck size={17} aria-hidden="true" />
                <span>同一阶段的关键状态由平台规则承接，不依赖脱离平台的私下交接。</span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="demo-boundary-card">
        <div>
          <p className="eyebrow">演示不是服务入口</p>
          <h2>先看清产品结构，再决定是否进入真实服务。</h2>
          <p>该页面不等同于实时服务、可约信息或商业运营状态；如需了解真实服务范围，请以小程序页面与相关规则为准。</p>
        </div>
        <Link href="/how-it-works" className="button button-secondary">
          阅读服务说明 <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
