// Monochrome geometric SVG icon set (FA-style). currentColor everywhere,
// zero dependencies, no emoji/pictographs. Stroke icons use fill=none;
// solid glyphs (spark, play) fill currentColor.
import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

function Base({
  size = 14,
  className,
  children,
  filled = false,
}: IconProps & { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className ?? "icon"}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SparkIcon(p: IconProps) {
  return (
    <Base {...p} filled>
      <path d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z" />
    </Base>
  );
}

export function CompassIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <polygon points="15.5,8.5 13.5,13.5 8.5,15.5 10.5,10.5" />
    </Base>
  );
}

export function RouteIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="5" cy="19" r="2.2" />
      <circle cx="19" cy="5" r="2.2" />
      <path d="M7 19 H15 A3 3 0 0 0 18 16 V7" strokeDasharray="3 2" />
    </Base>
  );
}

export function LayersIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M12 3 L21 8 L12 13 L3 8 Z" />
      <path d="M3 12.5 L12 17.5 L21 12.5" />
      <path d="M3 16.5 L12 21.5 L21 16.5" />
    </Base>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </Base>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M12 3 L22 20 H2 Z" />
      <line x1="12" y1="9.5" x2="12" y2="13.5" />
      <circle cx="12" cy="16.5" r="0.4" />
    </Base>
  );
}

export function XIcon(p: IconProps) {
  return (
    <Base {...p}>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </Base>
  );
}

export function ChevronLeftIcon(p: IconProps) {
  return (
    <Base {...p}>
      <polyline points="14.5,5 7.5,12 14.5,19" />
    </Base>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <Base {...p}>
      <polyline points="9.5,5 16.5,12 9.5,19" />
    </Base>
  );
}

export function PlayIcon(p: IconProps) {
  return (
    <Base {...p} filled>
      <path d="M7 4.5 L19 12 L7 19.5 Z" />
    </Base>
  );
}

export function PauseIcon(p: IconProps) {
  return (
    <Base {...p} filled>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </Base>
  );
}
