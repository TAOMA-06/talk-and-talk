"use client";

import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarCheck2,
  MessageCircleHeart,
  ShieldCheck,
} from "lucide-react";
import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { motionEase, usePrefersReducedMotion } from "./usePrefersReducedMotion";

type SignalPath = {
  id: "listen" | "arrange" | "partner";
  label: string;
  signal: string;
  title: string;
  description: string;
  href: string;
  action: string;
  Icon: typeof MessageCircleHeart;
  point: { x: number; y: number };
  progress: number;
};

const signalPaths: SignalPath[] = [
  {
    id: "listen",
    label: "想先被听见",
    signal: "01 / 认识服务",
    title: "先从一条清楚的服务路径开始。",
    description: "了解公开资料、服务方式与平台边界，再决定下一步是否适合你。",
    href: "/how-it-works",
    action: "了解服务路径",
    Icon: MessageCircleHeart,
    point: { x: 38, y: 102 },
    progress: 0,
  },
  {
    id: "arrange",
    label: "想把约定说清",
    signal: "02 / 确认规则",
    title: "把时间、价格与状态留在同一条线上。",
    description: "预约、履约与支持各自有位置，让一次连接不必靠私下反复确认。",
    href: "/how-it-works",
    action: "查看服务如何运作",
    Icon: CalendarCheck2,
    point: { x: 132, y: 49 },
    progress: 0.5,
  },
  {
    id: "partner",
    label: "想一起合作",
    signal: "03 / 讨论协作",
    title: "从服务边界清楚的合作开始。",
    description: "面向组织、社群和行业交流，先确定责任、隐私隔离与真实履约价值。",
    href: "/partners",
    action: "了解合作方式",
    Icon: BriefcaseBusiness,
    point: { x: 226, y: 102 },
    progress: 1,
  },
];

function pointOnSignalPath(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  const localT = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
  const [p0, p1, p2, p3] = t <= 0.5
    ? [[38, 102], [74, 102], [82, 49], [132, 49]]
    : [[132, 49], [182, 49], [190, 102], [226, 102]];
  const inverseT = 1 - localT;

  return {
    x: inverseT ** 3 * p0[0] + 3 * inverseT ** 2 * localT * p1[0] + 3 * inverseT * localT ** 2 * p2[0] + localT ** 3 * p3[0],
    y: inverseT ** 3 * p0[1] + 3 * inverseT ** 2 * localT * p1[1] + 3 * inverseT * localT ** 2 * p2[1] + localT ** 3 * p3[1],
  };
}

export function ConnectionPulse() {
  const [activePathId, setActivePathId] = useState<SignalPath["id"]>(signalPaths[0].id);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isSignalTraveling, setIsSignalTraveling] = useState(true);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [signalSequence, setSignalSequence] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const labelId = useId();
  const panelId = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const cardRef = useRef<HTMLElement | null>(null);
  const pointerFrame = useRef<number | null>(null);
  const pointerBounds = useRef<DOMRect | null>(null);
  const pointerTarget = useRef({ x: 0.5, y: 0.5 });
  const isInView = useInView(cardRef, { amount: 0.2, margin: "80px 0px" });
  const signalProgress = useMotionValue(0);
  const signalCursorX = useTransform(signalProgress, (progress) => pointOnSignalPath(progress).x);
  const signalCursorY = useTransform(signalProgress, (progress) => pointOnSignalPath(progress).y);
  const activeIndex = signalPaths.findIndex((path) => path.id === activePathId);
  const activePath = signalPaths[activeIndex] ?? signalPaths[0];
  const ActiveIcon = activePath.Icon;

  useEffect(() => {
    if (reducedMotion) {
      signalProgress.set(activePath.progress);
      return undefined;
    }

    const controls = animate(signalProgress, activePath.progress, {
      duration: 0.68,
      ease: motionEase,
    });
    const settleTimer = window.setTimeout(() => setIsSignalTraveling(false), 740);
    return () => {
      controls.stop();
      window.clearTimeout(settleTimer);
    };
  }, [activePath.progress, reducedMotion, signalProgress, signalSequence]);

  useEffect(() => {
    const updateVisibility = () => setIsPageVisible(document.visibilityState !== "hidden");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => () => {
    if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current);
  }, []);

  const selectPath = (index: number, focus = false) => {
    const nextPath = signalPaths[index];
    if (!nextPath) return;
    setActivePathId(nextPath.id);
    setHasInteracted(true);
    setIsSignalTraveling(true);
    setSignalSequence((sequence) => sequence + 1);
    if (focus) tabs.current[index]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % signalPaths.length;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + signalPaths.length) % signalPaths.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = signalPaths.length - 1;

    if (nextIndex === null) return;
    event.preventDefault();
    selectPath(nextIndex, true);
  };

  const applyPointerTarget = () => {
    pointerFrame.current = null;
    const card = cardRef.current;
    if (!card) return;
    const { x, y } = pointerTarget.current;

    card.dataset.pointerActive = "true";
    card.style.setProperty("--signal-tilt-x", `${(0.5 - y) * 4.2}deg`);
    card.style.setProperty("--signal-tilt-y", `${(x - 0.5) * 5.2}deg`);
    card.style.setProperty("--signal-map-x", `${(x - 0.5) * 5}px`);
    card.style.setProperty("--signal-map-y", `${(y - 0.5) * 4}px`);
    card.style.setProperty("--signal-orbit-x", `${(x - 0.5) * 15}px`);
    card.style.setProperty("--signal-orbit-y", `${(y - 0.5) * 11}px`);
    card.style.setProperty("--signal-panel-x", `${(x - 0.5) * 3}px`);
  };

  const cachePointerBounds = (event: ReactPointerEvent<HTMLElement>) => {
    if (reducedMotion || event.pointerType !== "mouse") return;
    pointerBounds.current = event.currentTarget.getBoundingClientRect();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (reducedMotion || event.pointerType !== "mouse") return;
    const bounds = pointerBounds.current || event.currentTarget.getBoundingClientRect();
    pointerBounds.current = bounds;
    pointerTarget.current = {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
    if (pointerFrame.current === null) {
      pointerFrame.current = window.requestAnimationFrame(applyPointerTarget);
    }
  };

  const resetPointer = () => {
    const card = cardRef.current;
    if (!card) return;

    if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = null;
    pointerBounds.current = null;
    card.removeAttribute("data-pointer-active");
    card.style.setProperty("--signal-tilt-x", "0deg");
    card.style.setProperty("--signal-tilt-y", "0deg");
    card.style.setProperty("--signal-map-x", "0px");
    card.style.setProperty("--signal-map-y", "0px");
    card.style.setProperty("--signal-orbit-x", "0px");
    card.style.setProperty("--signal-orbit-y", "0px");
    card.style.setProperty("--signal-panel-x", "0px");
  };

  return (
    <aside
      ref={cardRef}
      className="connection-pulse"
      aria-labelledby={labelId}
      data-signal-flow={!reducedMotion && isInView && isPageVisible && isSignalTraveling ? "running" : "paused"}
      onPointerEnter={cachePointerBounds}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
    >
      <div className="connection-pulse-topline">
        <span>连接信号</span>
        <span>{activePath.signal}</span>
      </div>

      <div className="connection-pulse-map" aria-hidden="true">
        <svg viewBox="0 0 264 148" focusable="false">
          <defs>
            <linearGradient id="connection-pulse-gradient" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#bde9e8" stopOpacity="0.54" />
              <stop offset="52%" stopColor="#f6d6a8" stopOpacity="0.98" />
              <stop offset="100%" stopColor="#bde9e8" stopOpacity="0.54" />
            </linearGradient>
          </defs>
          <path
            className="connection-pulse-route"
            d="M 38 102 C 74 102, 82 49, 132 49 C 182 49, 190 102, 226 102"
          />
          <motion.path
            className="connection-pulse-trace"
            d="M 38 102 C 74 102, 82 49, 132 49 C 182 49, 190 102, 226 102"
            initial={false}
            animate={{ pathLength: activePath.progress }}
            transition={{ duration: reducedMotion ? 0 : 0.68, ease: motionEase }}
          />
          {signalPaths.map((path, index) => (
            <g key={path.id} className={path.id === activePath.id ? "connection-pulse-node active" : "connection-pulse-node"}>
              <circle cx={path.point.x} cy={path.point.y} r="13" />
              <circle cx={path.point.x} cy={path.point.y} r="4" />
              <text x={path.point.x} y={path.point.y + 31} textAnchor="middle">0{index + 1}</text>
            </g>
          ))}
          <motion.circle
            className="connection-pulse-cursor"
            initial={false}
            cx={signalCursorX}
            cy={signalCursorY}
            r="21"
          />
        </svg>
      </div>

      <div className="connection-pulse-tabs" role="tablist" aria-label="选择要了解的连接路径">
        {signalPaths.map((path, index) => {
          const isActive = path.id === activePath.id;

          return (
            <button
              key={path.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${labelId}-${path.id}`}
              aria-controls={panelId}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={isActive ? "active" : undefined}
              onClick={() => selectPath(index)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {path.label}
            </button>
          );
        })}
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${labelId}-${activePath.id}`}
        className="connection-pulse-panel"
      >
        <motion.div
          key={activePath.id}
          initial={hasInteracted && !reducedMotion ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.28, ease: motionEase }}
        >
          <span className="connection-pulse-icon"><ActiveIcon size={18} aria-hidden="true" /></span>
          <p>{activePath.signal}</p>
          <h2 id={labelId}>{activePath.title}</h2>
          <span>{activePath.description}</span>
          <Link href={activePath.href} className="connection-pulse-link">
            {activePath.action} <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </motion.div>
      </div>

      <div className="connection-pulse-footnote">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>服务入口以微信小程序实际页面状态为准</span>
      </div>
    </aside>
  );
}
