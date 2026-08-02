"use client";

import type { ReactNode } from "react";

type HeroOrchestrationProps = {
  brand: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  actions: ReactNode;
  visual?: ReactNode;
  className?: string;
};

export function HeroOrchestration({
  brand,
  title,
  lead,
  actions,
  visual,
  className,
}: HeroOrchestrationProps) {
  return (
    <div className={`${className ?? ""} hero-orchestration`}>
      <div className="marketing-hero-copy">
        <div className="hero-entrance hero-entrance-brand">{brand}</div>
        <div className="hero-entrance hero-entrance-title">{title}</div>
        <div className="hero-entrance hero-entrance-lead">{lead}</div>
        <div className="hero-entrance hero-entrance-actions">{actions}</div>
      </div>
      {visual ? <div className="hero-entrance hero-entrance-visual">{visual}</div> : null}
    </div>
  );
}
