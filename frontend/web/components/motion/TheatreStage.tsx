"use client";

import {
  motion,
  useAnimationControls,
  useInView,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import { useEffect, useRef } from "react";

type TheatreStageProps = {
  variant: "listening" | "path" | "worktable" | "partners";
  className?: string;
};

const stageVariants: Variants = {
  // Keep the physical stage paint-visible before hydration/in-view. Only its
  // decorative paper layers wait offstage, so no-JS and slow devices never
  // see a content-sized blank hole.
  hidden: { opacity: 1, y: 0, rotateX: 0 },
  visible: {
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: {
      duration: 0.72,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.085,
      delayChildren: 0.08,
    },
  },
};

const layerVariants: Variants = {
  hidden: { opacity: 0, y: 26, rotate: -2.5, scale: 0.965 },
  visible: {
    opacity: 1,
    y: 0,
    rotate: 0,
    scale: 1,
    transition: { duration: 0.62, ease: [0.16, 1, 0.3, 1] },
  },
};

function LampProp() {
  return (
    <motion.div className="quiet-prop quiet-lamp" variants={layerVariants}>
      <svg viewBox="0 0 120 160" focusable="false">
        <path d="M38 56h44L70 17H50L38 56Z" className="prop-fill-apricot" />
        <path d="M60 56v63M34 132h52M44 119h32" />
        <circle cx="53" cy="43" r="2.5" />
        <circle cx="67" cy="43" r="2.5" />
        <path d="M55 49c3 3 7 3 10 0" />
      </svg>
      <i aria-hidden="true" />
    </motion.div>
  );
}

function CupProp() {
  return (
    <motion.div className="quiet-prop quiet-cup" variants={layerVariants}>
      <svg viewBox="0 0 120 120" focusable="false">
        <path d="M25 35h58v52c0 12-10 21-22 21H47c-12 0-22-9-22-21V35Z" className="prop-fill-lavender" />
        <path d="M83 50h9c12 0 12 25 0 25h-9M43 70h2M63 70h2M48 80c4 4 9 4 13 0M43 27c-7-8 5-11 0-19M62 27c-7-8 5-11 0-19" />
      </svg>
    </motion.div>
  );
}

function ThreadProp() {
  return (
    <motion.div className="quiet-prop quiet-thread" variants={layerVariants}>
      <svg viewBox="0 0 180 120" focusable="false">
        <path d="M25 70C48 21 80 105 108 55c16-28 29-22 47-7" className="thread-line" />
        <circle cx="25" cy="70" r="11" className="prop-fill-blue" />
        <circle cx="108" cy="55" r="11" className="prop-fill-mint" />
        <circle cx="155" cy="48" r="11" className="prop-fill-rose" />
        <circle cx="21" cy="68" r="1.8" /><circle cx="29" cy="68" r="1.8" />
        <path d="M22 74c2 2 5 2 7 0" />
      </svg>
    </motion.div>
  );
}

function FolderProp() {
  return (
    <motion.div className="quiet-prop quiet-folder" variants={layerVariants}>
      <svg viewBox="0 0 180 140" focusable="false">
        <path d="M20 38h54l12 14h74v70H20V38Z" className="prop-fill-butter" />
        <path d="M20 54h140M75 84h2M102 84h2M82 94c5 5 10 5 15 0" />
        <path d="M128 20v32M113 35h30" className="folder-spark" />
      </svg>
    </motion.div>
  );
}

function ListeningScene() {
  return (
    <>
      <LampProp />
      <CupProp />
      <motion.div className="theatre-card theatre-card-back theatre-card-rose" variants={layerVariants}>
        <strong>整理思绪</strong>
      </motion.div>
      <motion.div className="theatre-card theatre-card-mid theatre-card-mint" variants={layerVariants}>
        <strong>聊聊此刻</strong>
      </motion.div>
      <motion.div className="theatre-card theatre-card-front theatre-card-blue" variants={layerVariants}>
        <span className="theatre-card-mark">•••</span>
        <strong>听你说</strong><span>不用准备答案。</span>
      </motion.div>
    </>
  );
}

function PathScene() {
  return (
    <>
      <ThreadProp />
      <motion.div className="path-paper path-paper-back" variants={layerVariants} />
      <motion.ol className="path-card-stack" variants={layerVariants}>
        <li><span>01</span><strong>发现</strong></li>
        <li><span>02</span><strong>预约</strong></li>
        <li><span>03</span><strong>履约</strong></li>
        <li><span>04</span><strong>支持</strong></li>
      </motion.ol>
    </>
  );
}

function WorktableScene() {
  return (
    <>
      <FolderProp />
      <motion.div className="work-grid-paper" variants={layerVariants} />
      <motion.div className="work-note work-note-main" variants={layerVariants}>
        <strong>温柔与边界</strong>
      </motion.div>
      <motion.div className="work-note work-note-pin" variants={layerVariants}>
        <i /><strong>只写已核验</strong>
      </motion.div>
    </>
  );
}

function PartnersScene() {
  return (
    <>
      <FolderProp />
      <motion.div className="partner-paper partner-paper-back" variants={layerVariants} />
      <motion.div className="partner-paper partner-paper-main" variants={layerVariants}>
        <strong>先确认边界</strong>
        <ul><li>服务范围</li><li>隐私责任</li><li>履约价值</li></ul>
      </motion.div>
      <motion.div className="partner-stamp" variants={layerVariants}><span>✓</span><strong>清楚再开始</strong></motion.div>
    </>
  );
}

export function TheatreStage({ variant, className = "" }: TheatreStageProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.14, margin: "0px 0px 4% 0px" });
  const reducedMotion = useReducedMotion();
  const controls = useAnimationControls();

  useEffect(() => {
    if (reducedMotion) {
      controls.set("visible");
      return undefined;
    }
    if (!inView) return undefined;

    // SSR and no-JS keep every layer visible. Once the browser has confirmed
    // the stage is in view, Framer briefly deals the decorative layers from
    // their offstage poses and settles them exactly once.
    controls.set("hidden");
    const frame = window.requestAnimationFrame(() => {
      void controls.start("visible");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [controls, inView, reducedMotion]);

  return (
    <motion.aside
      ref={ref}
      aria-hidden="true"
      className={`theatre-stage theatre-stage-${variant} ${className}`.trim()}
      variants={stageVariants}
      initial={false}
      animate={controls}
    >
      <div className="theatre-stage-grid" />
      {variant === "listening" ? <ListeningScene /> : null}
      {variant === "path" ? <PathScene /> : null}
      {variant === "worktable" ? <WorktableScene /> : null}
      {variant === "partners" ? <PartnersScene /> : null}
    </motion.aside>
  );
}
