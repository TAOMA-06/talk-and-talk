"use client";

/**
 * Lightweight decorative bubble constellation for section backgrounds.
 * Pure CSS motion for performance; SVG structure for crisp edges.
 */
export function BubbleNetwork({ className = "" }: { className?: string }) {
  return (
    <div className={`bubble-network ${className}`.trim()} aria-hidden="true">
      <span className="bn-orb bn-1" />
      <span className="bn-orb bn-2" />
      <span className="bn-orb bn-3" />
      <span className="bn-orb bn-4" />
      <span className="bn-orb bn-5" />
      <span className="bn-orb bn-6" />
      <span className="bn-line bl-1" />
      <span className="bn-line bl-2" />
      <span className="bn-line bl-3" />
    </div>
  );
}
