import Image from "next/image";

type BrandMarkProps = {
  size?: number;
  className?: string;
  priority?: boolean;
};

/**
 * Official Talk&Talk mark — speech-bubble pair + heart + soft bubble aura.
 * Source of truth: brand/app-icon.png (product icon).
 */
export default function BrandMark({ size = 40, className = "", priority = false }: BrandMarkProps) {
  return (
    <span className={`brand-mark-media ${className}`.trim()} style={{ width: size, height: size }}>
      <Image
        src="/brand/app-icon.png"
        alt=""
        width={size}
        height={size}
        priority={priority}
        className="brand-mark-image"
        aria-hidden="true"
      />
    </span>
  );
}
