"use client";

import { useEffect, useState } from "react";

export function usePrefersReducedMotion() {
  // Start conservatively: server-rendered content is static, and motion only
  // becomes available after the browser has confirmed the user's preference.
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

export const motionEase = [0.22, 1, 0.36, 1] as const;
export const motionDuration = 0.55;
