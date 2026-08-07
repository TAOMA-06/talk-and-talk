"use client";

import { motion } from "framer-motion";
import { useEffect, useId, useMemo, useState } from "react";

import { motionEase, usePrefersReducedMotion } from "./usePrefersReducedMotion";

type Bubble = {
  id: string;
  x: number;
  y: number;
  r: number;
  delay: number;
  duration: number;
  opacity: number;
};

type Link = {
  from: number;
  to: number;
};

const baseBubbles: Array<Omit<Bubble, "id">> = [
  { x: 18, y: 28, r: 42, delay: 0, duration: 9.2, opacity: 0.55 },
  { x: 38, y: 52, r: 28, delay: 0.4, duration: 7.6, opacity: 0.72 },
  { x: 58, y: 24, r: 36, delay: 0.8, duration: 8.4, opacity: 0.6 },
  { x: 74, y: 48, r: 48, delay: 0.2, duration: 10.1, opacity: 0.5 },
  { x: 46, y: 72, r: 22, delay: 1.1, duration: 6.8, opacity: 0.78 },
  { x: 22, y: 68, r: 18, delay: 0.6, duration: 7.2, opacity: 0.66 },
  { x: 82, y: 22, r: 16, delay: 1.4, duration: 8.8, opacity: 0.7 },
  { x: 68, y: 76, r: 26, delay: 0.9, duration: 9.5, opacity: 0.58 },
  { x: 12, y: 48, r: 14, delay: 1.6, duration: 6.4, opacity: 0.74 },
  { x: 88, y: 62, r: 20, delay: 0.3, duration: 7.9, opacity: 0.62 },
];

const links: Link[] = [
  { from: 0, to: 1 },
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  { from: 1, to: 4 },
  { from: 0, to: 5 },
  { from: 3, to: 7 },
  { from: 4, to: 7 },
  { from: 2, to: 6 },
  { from: 3, to: 9 },
  { from: 5, to: 8 },
  { from: 4, to: 9 },
];

type BubbleFieldProps = {
  className?: string;
  variant?: "hero" | "panel" | "ambient";
  label?: string;
};

export function BubbleField({
  className = "",
  variant = "hero",
  label = "连接空泡",
}: BubbleFieldProps) {
  const reducedMotion = usePrefersReducedMotion();
  const fieldId = useId();
  const [activeLink, setActiveLink] = useState(0);

  const bubbles = useMemo(
    () => baseBubbles.map((bubble, index) => ({ ...bubble, id: `${fieldId}-${index}` })),
    [fieldId],
  );

  useEffect(() => {
    if (reducedMotion) return undefined;
    const timer = window.setInterval(() => {
      setActiveLink((current) => (current + 1) % links.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  return (
    <aside
      className={`bubble-field bubble-field-${variant} ${className}`.trim()}
      aria-label={label}
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <svg className="bubble-field-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id={`${fieldId}-orb`} cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.92)" />
            <stop offset="45%" stopColor="rgba(190, 230, 214, 0.42)" />
            <stop offset="100%" stopColor="rgba(15, 76, 58, 0.12)" />
          </radialGradient>
          <linearGradient id={`${fieldId}-line`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(15, 76, 58, 0.08)" />
            <stop offset="50%" stopColor="rgba(42, 140, 110, 0.55)" />
            <stop offset="100%" stopColor="rgba(15, 76, 58, 0.08)" />
          </linearGradient>
          <filter id={`${fieldId}-soft`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="0.6" />
          </filter>
        </defs>

        {links.map((link, index) => {
          const from = bubbles[link.from];
          const to = bubbles[link.to];
          if (!from || !to) return null;
          const isActive = index === activeLink;
          return (
            <motion.line
              key={`${from.id}-${to.id}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={`url(#${fieldId}-line)`}
              strokeWidth={isActive ? 0.45 : 0.22}
              strokeLinecap="round"
              initial={false}
              animate={{
                opacity: isActive ? 0.95 : 0.28,
              }}
              transition={{ duration: reducedMotion ? 0 : 0.6, ease: motionEase }}
            />
          );
        })}

        {bubbles.map((bubble) => (
          <motion.g
            key={bubble.id}
            initial={false}
            animate={
              reducedMotion
                ? { x: 0, y: 0 }
                : {
                    y: [0, -1.6, 0.8, 0],
                    x: [0, 0.7, -0.5, 0],
                  }
            }
            transition={
              reducedMotion
                ? { duration: 0 }
                : {
                    duration: bubble.duration,
                    delay: bubble.delay,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
            }
          >
            <circle
              cx={bubble.x}
              cy={bubble.y}
              r={bubble.r / 4.2}
              fill={`url(#${fieldId}-orb)`}
              opacity={bubble.opacity}
              stroke="rgba(255,255,255,0.72)"
              strokeWidth="0.18"
            />
            <circle
              cx={bubble.x - bubble.r / 18}
              cy={bubble.y - bubble.r / 16}
              r={bubble.r / 18}
              fill="rgba(255,255,255,0.55)"
              filter={`url(#${fieldId}-soft)`}
            />
          </motion.g>
        ))}

        {!reducedMotion && (
          <motion.circle
            r="0.9"
            fill="rgba(42, 140, 110, 0.9)"
            initial={false}
            animate={{
              cx: [
                bubbles[links[activeLink].from].x,
                bubbles[links[activeLink].to].x,
              ],
              cy: [
                bubbles[links[activeLink].from].y,
                bubbles[links[activeLink].to].y,
              ],
              opacity: [0.2, 1, 0.2],
            }}
            transition={{ duration: 1.6, ease: motionEase }}
          />
        )}
      </svg>

      <div className="bubble-field-caption">
        <span className="bubble-field-dot" aria-hidden="true" />
        <strong>连接空泡</strong>
        <p>每一个空间都有边界；连接发生在清楚的路径上。</p>
      </div>
    </aside>
  );
}
