"use client";

import Image from "next/image";
import { motion } from "framer-motion";

import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/**
 * Hero centerpiece: official app icon with a restrained orbital frame.
 * Signature visual derived from the product mark (dual bubbles → heart).
 */
export function IconOrbit() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <aside className="icon-orbit" aria-label="Talk&Talk 品牌符号">
      <div className="icon-orbit-stage">
        <span className="icon-orbit-ring" aria-hidden="true" />
        <span className="icon-orbit-ring ring-2" aria-hidden="true" />

        {[0, 1, 2, 3].map((index) => (
          <motion.span
            key={index}
            className={`icon-orbit-bubble b-${index}`}
            aria-hidden="true"
            animate={
              reducedMotion
                ? undefined
                : {
                    y: [0, -6 - (index % 2) * 2, 0],
                  }
            }
            transition={
              reducedMotion
                ? undefined
                : {
                    duration: 6 + index * 0.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: index * 0.25,
                  }
            }
          />
        ))}

        <motion.div
          className="icon-orbit-core"
          animate={reducedMotion ? undefined : { y: [0, -4, 0] }}
          transition={
            reducedMotion
              ? undefined
              : { duration: 7, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <Image
            src="/brand/app-icon.png"
            alt="Talk&Talk 应用图标：两枚对话气泡相拥成心，周围是柔和空泡"
            width={220}
            height={220}
            priority
            className="icon-orbit-image"
          />
        </motion.div>

        <div className="icon-orbit-caption">
          <strong>连接空泡</strong>
          <p>两枚对话相遇，形成心的形状——边界清楚，连接温柔。</p>
        </div>
      </div>
    </aside>
  );
}
