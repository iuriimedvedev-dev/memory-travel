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

export function ClockIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12,7 12,12 15.5,14" />
    </Base>
  );
}

/** Direct relations / degree of a node (replaces the old diamond-bullet glyph). */
export function LinkIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M10.2 13.8 L13.8 10.2" />
      <path d="M8.4 8.4 L6.2 10.6 a2.9 2.9 0 0 0 4.1 4.1 l1.3 -1.3" />
      <path d="M15.6 15.6 L17.8 13.4 a2.9 2.9 0 0 0 -4.1 -4.1 l-1.3 1.3" />
    </Base>
  );
}

export function GearIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8 v3 M12 18.2 v3 M2.8 12 h3 M18.2 12 h3 M5.5 5.5 l2.1 2.1 M16.4 16.4 l2.1 2.1 M18.5 5.5 l-2.1 2.1 M7.6 16.4 l-2.1 2.1" />
    </Base>
  );
}

export function CameraIcon(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="2.8" y="7" width="12.4" height="10" rx="2" />
      <path d="M15.2 11.2 L21.2 8 V16 L15.2 12.8" />
    </Base>
  );
}

export function HandIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M9 11 V5.5 a1.4 1.4 0 0 1 2.8 0 V11" />
      <path d="M11.8 11 V4.6 a1.4 1.4 0 0 1 2.8 0 V11" />
      <path d="M14.6 11.4 V6.6 a1.4 1.4 0 0 1 2.8 0 V13" />
      <path d="M9 11.4 V9.6 a1.4 1.4 0 0 0 -2.8 0 V14 a6.4 6.4 0 0 0 6.4 6.4 h1.2 A5 5 0 0 0 19 15.4 V12" />
    </Base>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Base {...p}>
      <polyline points="4,12 9,17 20,6" />
    </Base>
  );
}

export function MinimizeIcon(p: IconProps) {
  return (
    <Base {...p}>
      <line x1="4" y1="12" x2="20" y2="12" />
    </Base>
  );
}

export function MaximizeIcon(p: IconProps) {
  return (
    <Base {...p}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </Base>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Base {...p}>
      <polyline points="6 9 12 15 18 9" />
    </Base>
  );
}

export function ChevronUpIcon(p: IconProps) {
  return (
    <Base {...p}>
      <polyline points="18 15 12 9 6 15" />
    </Base>
  );
}

export function NodesIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <line x1="8.2" y1="7.2" x2="15.8" y2="7.2" />
      <line x1="7.3" y1="8.3" x2="10.7" y2="15.7" />
      <line x1="16.7" y1="8.3" x2="13.3" y2="15.7" />
    </Base>
  );
}

export function ArrowLeftIcon(p: IconProps) {
  return (
    <Base {...p}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="11.5 5.5 5 12 11.5 18.5" />
    </Base>
  );
}

export function SunIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5 v2.2 M12 19.3 v2.2 M4.2 12 H2 M22 12 h-2.2 M5.6 5.6 l1.6 1.6 M16.8 16.8 l1.6 1.6 M18.4 5.6 l-1.6 1.6 M7.2 16.8 l-1.6 1.6" />
    </Base>
  );
}

export function MoonIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M20.4 14.5 A8.5 8.5 0 1 1 9.5 3.6 a6.8 6.8 0 0 0 10.9 10.9 Z" />
    </Base>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
    </Base>
  );
}

export function DatabaseIcon(p: IconProps) {
  return (
    <Base {...p}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5 v6.5 c0 1.55 3.36 2.8 7.5 2.8 s7.5 -1.25 7.5 -2.8 V5.5" />
      <path d="M4.5 12 v6.5 c0 1.55 3.36 2.8 7.5 2.8 s7.5 -1.25 7.5 -2.8 V12" />
    </Base>
  );
}

export function DialogScopeIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M4 6.5 A2.5 2.5 0 0 1 6.5 4 h11 A2.5 2.5 0 0 1 20 6.5 v7 A2.5 2.5 0 0 1 17.5 16 H10 l-4.2 3.6 V16 H6.5 A2.5 2.5 0 0 1 4 13.5 Z" />
      <line x1="8" y1="8.8" x2="16" y2="8.8" />
      <line x1="8" y1="12" x2="13" y2="12" />
    </Base>
  );
}

export function DeptScopeIcon(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </Base>
  );
}

export function KnotGateLogoMark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      className={className ?? "kg-logo-mark"}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="kg-nord-grad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#88C0D0" />
          <stop offset="52%" stopColor="#81A1C1" />
          <stop offset="100%" stopColor="#B48EAD" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="26" height="26" rx="7.5" fill="url(#kg-nord-grad)" />
      <rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="rgba(236, 239, 244, 0.36)" strokeWidth="1" />
      <path
        d="M9.5 9.5 L18.5 18.5 M18.5 9.5 L9.5 18.5 M14 7.5 V20.5"
        stroke="#1E2430"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeOpacity="0.65"
      />
      <circle cx="14" cy="14" r="3.1" fill="#ECEFF4" stroke="#2E3440" strokeWidth="1.3" />
      <circle cx="9.2" cy="9.2" r="2.1" fill="#ECEFF4" />
      <circle cx="18.8" cy="9.2" r="2.1" fill="#ECEFF4" />
      <circle cx="9.2" cy="18.8" r="2.1" fill="#ECEFF4" />
      <circle cx="18.8" cy="18.8" r="2.1" fill="#ECEFF4" />
    </svg>
  );
}
