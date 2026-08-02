"use client";

import {
  ArrowUpRight,
  CalendarCheck2,
  MessageCircleHeart,
  ReceiptText,
  ShieldCheck,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { motionEase, usePrefersReducedMotion } from "./usePrefersReducedMotion";

type JourneyNode = {
  id: string;
  label: string;
  title: string;
  description: string;
  evidence: string;
  Icon: typeof UserRoundCheck;
};

const nodes: JourneyNode[] = [
  {
    id: "profile",
    label: "先认识",
    title: "资料先经过平台流程",
    description: "从公开资料、擅长主题和服务方式开始了解，不必靠模糊的私下判断。",
    evidence: "公开前的资料审核与展示规则",
    Icon: UserRoundCheck,
  },
  {
    id: "booking",
    label: "再约时间",
    title: "时间、价格与确认都说清楚",
    description: "服务商品和可约时段集中呈现，预约确认沿着同一条订单状态流转。",
    evidence: "服务方式、可约容量与订单状态",
    Icon: CalendarCheck2,
  },
  {
    id: "payment",
    label: "留在平台",
    title: "交易不需要离开平台",
    description: "支付、取消、退款和履约状态使用同一份订单记录，减少含混的交接。",
    evidence: "支付、取消、退款与订单时间线",
    Icon: WalletCards,
  },
  {
    id: "conversation",
    label: "认真沟通",
    title: "把要说的话留在可支持的空间",
    description: "服务发生在平台内会话中，既保留交流的温度，也让关键边界更清晰。",
    evidence: "平台内会话与内容治理入口",
    Icon: MessageCircleHeart,
  },
  {
    id: "support",
    label: "有据可循",
    title: "遇到问题，有一条能回看的路径",
    description: "订单、举报与售后支持彼此连接，让每一步都不是无从核对的口头承诺。",
    evidence: "举报、售后与服务证据留痕",
    Icon: ShieldCheck,
  },
];

const moments = [
  { id: "talk", label: "想先说说", copy: "从一个能好好听的人开始", nodeId: "profile" },
  { id: "pause", label: "想缓一口气", copy: "先看看此刻适合的服务方式", nodeId: "booking" },
  { id: "quiet", label: "想安静陪伴", copy: "把时间、规则和边界先讲清楚", nodeId: "conversation" },
];

export function TrustJourney() {
  const [activeNodeId, setActiveNodeId] = useState(nodes[0].id);
  const [activeMomentId, setActiveMomentId] = useState(moments[0].id);
  const [hasSelectedJourneyNode, setHasSelectedJourneyNode] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<1 | -1>(1);
  const reducedMotion = usePrefersReducedMotion();
  const journeyId = useId();
  const panelId = `${journeyId}-panel`;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const activeNode = nodes.find((node) => node.id === activeNodeId) ?? nodes[0];
  const activeNodeIndex = Math.max(0, nodes.findIndex((node) => node.id === activeNode.id));
  const activeMoment = moments.find((moment) => moment.id === activeMomentId) ?? moments[0];
  const ActiveIcon = activeNode.Icon;

  useEffect(() => {
    const tab = tabRefs.current[activeNodeIndex];
    const tabList = tabListRef.current;
    if (!tab || !tabList) return;

    // The tab list is a horizontal, touch-scrollable rail on phones. Keep a
    // programmatic selection visible without stealing focus from the intent
    // button that triggered it.
    const targetLeft = Math.max(0, tab.offsetLeft - (tabList.clientWidth - tab.offsetWidth) / 2);
    tabList.scrollTo({
      left: targetLeft,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [activeNodeIndex, reducedMotion]);

  const selectNode = (index: number) => {
    const nextNode = nodes[index];
    if (!nextNode) return;
    setTransitionDirection(index >= activeNodeIndex ? 1 : -1);
    setActiveNodeId(nextNode.id);
    setHasSelectedJourneyNode(true);
    tabRefs.current[index]?.focus();
  };

  const selectNodeById = (id: string) => {
    const index = nodes.findIndex((node) => node.id === id);
    if (index < 0) return;
    setTransitionDirection(index >= activeNodeIndex ? 1 : -1);
    setActiveNodeId(id);
    setHasSelectedJourneyNode(true);
  };

  const selectMoment = (momentId: string) => {
    const nextMoment = moments.find((moment) => moment.id === momentId);
    if (!nextMoment) return;
    setActiveMomentId(nextMoment.id);
    selectNodeById(nextMoment.nodeId);
  };

  const handleNodeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % nodes.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + nodes.length) % nodes.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = nodes.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectNode(nextIndex);
  };

  return (
    <section className="trust-journey" aria-labelledby="trust-journey-title">
      <div className="trust-journey-head">
        <div>
          <p className="journey-kicker">可信陪伴链</p>
          <h2 id="trust-journey-title">每一次连接，都沿着一条能被看见的路径发生。</h2>
          <p>
            {activeMoment.copy}。点击任意节点，查看 Talk&amp;Talk 如何将边界写进真实的服务流程。
          </p>
        </div>
        <div className="journey-intents" role="group" aria-label="选择此刻需要的陪伴方式">
          {moments.map((moment) => (
            <button
              key={moment.id}
              type="button"
              aria-pressed={activeMoment.id === moment.id}
              className={activeMoment.id === moment.id ? "active" : undefined}
              onClick={() => selectMoment(moment.id)}
            >
              {moment.label}
            </button>
          ))}
        </div>
      </div>

      <div className="trust-journey-scene" data-active={activeNode.id} data-active-index={activeNodeIndex}>
        <div className="trust-journey-path" aria-hidden="true">
          <motion.span
            className="trust-journey-path-fill"
            initial={false}
            // This is a navigation map, not a checkout-progress tracker. Keep
            // the whole path present while a visitor compares any node.
            animate={{ scaleY: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.58, ease: motionEase }}
          />
        </div>

        <div
          ref={tabListRef}
          className="trust-journey-nodes"
          role="tablist"
          aria-label="可信陪伴链节点"
        >
          {nodes.map((node, index) => {
            const Icon = node.Icon;
            const isActive = node.id === activeNode.id;
            const state = isActive ? "current" : "related";
            const tabId = `${journeyId}-${node.id}-tab`;
            const content = (
              <>
                <span className="journey-node-index">0{index + 1}</span>
                <span className="journey-node-icon"><Icon size={18} aria-hidden="true" /></span>
                <span className="journey-node-copy">
                  <small>{node.label}</small>
                  <strong>{node.title}</strong>
                </span>
              </>
            );

            return (
              <motion.button
                key={node.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={tabId}
                aria-controls={panelId}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={isActive ? "trust-journey-node active" : "trust-journey-node"}
                data-state={state}
                initial={false}
                animate={{
                  opacity: isActive ? 1 : 0.72,
                  x: isActive && !reducedMotion ? 4 : 0,
                }}
                transition={{ duration: 0.22, ease: motionEase }}
                whileHover={reducedMotion ? undefined : { x: 4 }}
                whileTap={reducedMotion ? undefined : { scale: 0.99 }}
                onClick={() => selectNodeById(node.id)}
                onKeyDown={(event) => handleNodeKeyDown(event, index)}
              >
                {content}
              </motion.button>
            );
          })}
        </div>

        <div className="journey-mobile-position" aria-live="polite">
          <span>正在查看</span>
          <strong>{String(activeNodeIndex + 1).padStart(2, "0")} / {String(nodes.length).padStart(2, "0")}</strong>
          <span>{activeNode.label}</span>
          <i aria-hidden="true">
            {nodes.map((node) => <b key={node.id} data-current={node.id === activeNode.id} />)}
          </i>
        </div>

        <div className="journey-detail-wrap">
          <article
            id={panelId}
            role="tabpanel"
            aria-labelledby={`${journeyId}-${activeNode.id}-tab`}
            className="journey-detail"
            tabIndex={0}
          >
            <motion.div
              key={activeNode.id}
              className="journey-detail-content"
              initial={hasSelectedJourneyNode && !reducedMotion ? { opacity: 0, x: 14 * transitionDirection, y: 4 } : false}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.24, ease: motionEase }}
            >
              <span className="journey-detail-icon"><ActiveIcon size={24} aria-hidden="true" /></span>
              <p className="journey-detail-label">平台可以确认</p>
              <h3>{activeNode.title}</h3>
              <p>{activeNode.description}</p>
              <div className="journey-evidence">
                <ReceiptText size={17} aria-hidden="true" />
                <span>{activeNode.evidence}</span>
              </div>
              <Link href="/how-it-works" className="journey-detail-link">
                查看服务如何运作 <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </motion.div>
          </article>
        </div>
      </div>
    </section>
  );
}
