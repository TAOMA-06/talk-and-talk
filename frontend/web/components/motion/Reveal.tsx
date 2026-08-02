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

import { motionDuration, usePrefersReducedMotion } from "./usePrefersReducedMotion";

const revealEasing = "cubic-bezier(0.22, 1, 0.36, 1)";

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

    let activeAnimation: Animation | null = null;
    const reveal = () => {
      activeAnimation?.cancel();
      node.dataset.revealState = "entering";
      activeAnimation = node.animate(
        [
          { opacity: 0, transform: "translate3d(0, 22px, 0)" },
          { opacity: 1, transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: Math.round(motionDuration * 1_000),
          delay: Math.max(0, Math.round(delay * 1_000)),
          easing: revealEasing,
          fill: "both",
        },
      );
      activeAnimation.finished
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
      activeAnimation?.cancel();
    };
  }, [delay, once, reducedMotion]);

  return attachRef;
}

export function Reveal({
  children,
  className,
  delay = 0,
  once = true,
  as = "div",
}: RevealProps) {
  const ref = useScrollEntrance(delay, once);

  if (as === "section") return <section ref={ref} className={className}>{children}</section>;
  if (as === "article") return <article ref={ref} className={className}>{children}</article>;
  if (as === "header") return <header ref={ref} className={className}>{children}</header>;
  return <div ref={ref} className={className}>{children}</div>;
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
  const ref = useScrollEntrance(delay, true);
  return <div ref={ref} className={className}>{children}</div>;
}
