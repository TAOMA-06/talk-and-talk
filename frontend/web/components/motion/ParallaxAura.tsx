"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef, type ReactNode } from "react";

export function ParallaxAura({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const yA = useTransform(scrollYProgress, [0, 1], [0, 48]);
  const yB = useTransform(scrollYProgress, [0, 1], [0, -32]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.35]);

  return (
    <div ref={ref} className={className}>
      {!reduced && (
        <>
          <motion.span className="parallax-blob blob-a" style={{ y: yA, opacity }} aria-hidden />
          <motion.span className="parallax-blob blob-b" style={{ y: yB, opacity }} aria-hidden />
        </>
      )}
      {reduced && (
        <>
          <span className="parallax-blob blob-a" aria-hidden />
          <span className="parallax-blob blob-b" aria-hidden />
        </>
      )}
      {children}
    </div>
  );
}
