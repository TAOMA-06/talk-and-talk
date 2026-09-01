"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { motion, useAnimationControls } from "framer-motion";

import { motionDuration, usePrefersReducedMotion } from "./usePrefersReducedMotion";

const revealEasing = [0.16, 1, 0.3, 1] as const;

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  once?: boolean;
  as?: "div" | "section" | "article" | "header";
};

type RevealItemProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

/**
 * Progressive, scroll-bound entrance motion without an SSR-hidden state.
 *
 * The markup is always paint-visible first. Once the browser confirms that the
 * user allows motion, only content that is still below the initial viewport is
 * animated with compositor-friendly opacity/transform keyframes. This avoids
 * a blank hero, protects no-JS rendering, and prevents a late hydration flash
 * on the page's first meaningful content.
 */
function useScrollEntrance(delay: number, once: boolean) {
  const reducedMotion = usePrefersReducedMotion();
  const controls = useAnimationControls();
  const nodeRef = useRef<HTMLElement | null>(null);
  const attachRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  useEffect(() => {
    const node = nodeRef.current;
    if (reducedMotion || !node || !("IntersectionObserver" in window)) return;

    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const initialBounds = node.getBoundingClientRect();
    const startsInInitialView = initialBounds.top < viewportHeight * 0.82 && initialBounds.bottom > 0;
    if (startsInInitialView) {
      node.dataset.revealState = "static";
      return;
    }

    const reveal = () => {
      node.dataset.revealState = "entering";
      controls.set({ opacity: 0, y: 22, rotateX: 2.5 });
      controls
        .start({
          opacity: 1,
          y: 0,
          rotateX: 0,
          transition: {
            duration: motionDuration,
            delay: Math.max(0, delay),
            ease: revealEasing,
          },
        })
        .then(() => {
          node.dataset.revealState = "complete";
        })
        .catch(() => undefined);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        reveal();
        if (once) observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      controls.stop();
    };
  }, [controls, delay, once, reducedMotion]);

  return [attachRef, controls] as const;
}

export function Reveal({
  children,
  className,
  delay = 0,
  once = true,
  as = "div",
}: RevealProps) {
  const [ref, controls] = useScrollEntrance(delay, once);

  if (as === "section") return <motion.section ref={ref} className={className} initial={false} animate={controls}>{children}</motion.section>;
  if (as === "article") return <motion.article ref={ref} className={className} initial={false} animate={controls}>{children}</motion.article>;
  if (as === "header") return <motion.header ref={ref} className={className} initial={false} animate={controls}>{children}</motion.header>;
  return <motion.div ref={ref} className={className} initial={false} animate={controls}>{children}</motion.div>;
}

type RevealStaggerProps = {
  children: ReactNode;
  className?: string;
  stagger?: number;
};

export function RevealStagger({ children, className, stagger = 0.08 }: RevealStaggerProps) {
  return (
    <div className={className}>
      {Children.map(children, (child, index) => {
        if (!isValidElement<RevealItemProps>(child)) return child;
        return cloneElement(child, { delay: child.props.delay ?? index * stagger });
      })}
    </div>
  );
}

export function RevealItem({ children, className, delay = 0 }: RevealItemProps) {
  const [ref, controls] = useScrollEntrance(delay, true);
  return <motion.div ref={ref} className={className} initial={false} animate={controls}>{children}</motion.div>;
}
