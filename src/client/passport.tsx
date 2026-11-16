import { useId, type CSSProperties } from 'react';
import { district } from '../shared/districts';
import { markBroken, useIcon } from './icons';
import { INK, tiltOf } from './ink';

/*
 * Passport visuals. Every stamp is the community itself: its real icon printed in ink,
 * or its name when it has no icon. The district only decides the ink colour (./ink.ts).
 */

/** Shared SVG filter that roughens ink edges. Render once per page. */
export const InkDefs = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
    <filter id="ink-rough" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={3} result="t" />
      <feDisplacementMap in="SourceGraphic" in2="t" scale={2.2} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/**
 * Prints an image in one ink: dark pixels become ink, light pixels become paper.
 * Transparent pixels stay transparent.
 */
const InkPrint = ({ id, color }: { id: string; color: string }) => {
  const [r, g, b] = rgb(color);
  return (
    <filter id={id} colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={`0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} -0.45 -0.85 -0.16 0 1.5`} />
      <feComposite in2="SourceGraphic" operator="in" />
    </filter>
  );
};

/** The community's icon in ink, or its name when there's no icon. Centred on (cx, cy). */
const Mark = (p: { sub: string; uid: string; color: string; cx: number; cy: number; r: number; nameWidth: number }) => {
  const icon = useIcon(p.sub);
  if (icon === undefined) return null;
  if (icon) {
    return (
      <>
        <defs>
          <clipPath id={`${p.uid}c`}>
            <circle cx={p.cx} cy={p.cy} r={p.r} />
          </clipPath>
          <InkPrint id={`${p.uid}i`} color={p.color} />
        </defs>
        <image
          href={icon}
          x={p.cx - p.r}
          y={p.cy - p.r}
          width={p.r * 2}
          height={p.r * 2}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${p.uid}c)`}
          filter={`url(#${p.uid}i)`}
          onError={() => markBroken(p.sub)}
        />
      </>
    );
  }
  const name = p.sub;
  const size = clamp(p.nameWidth / (name.length * 0.5), 8, p.r * 0.62);
  const squeeze = name.length * size * 0.5 > p.nameWidth;
  return (
    <text
      x={p.cx}
      y={p.cy + size * 0.35}
      textAnchor="middle"
      fontFamily="'Reddit Sans Condensed', sans-serif"
      fontWeight="900"
      fontSize={size}
      fill="currentColor"
      {...(squeeze ? { textLength: p.nameWidth, lengthAdjust: 'spacingAndGlyphs' } : {})}
    >
      {name}
    </text>
  );
};

/** Round entry stamp: sub name on the top arc, caption on the bottom, the community's icon inside. */
export const Stamp = (p: { sub: string; caption: string; size?: number; className?: string; style?: CSSProperties }) => {
  const d = district(p.sub);
  const color = INK[d.id];
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const top = `r/${p.sub}`.toUpperCase();
  const topSize = clamp((175 / top.length - 1) / 0.62, 7, 13);
  const bottom = p.caption.toUpperCase();
  const bottomSize = clamp((150 / bottom.length - 1) / 0.62, 6.5, 10.5);
  return (
    <svg
      className={`stamp ${p.className ?? ''}`}
      viewBox="0 0 150 150"
      width={p.size ?? 132}
      height={p.size ?? 132}
      style={{ color, rotate: `${tiltOf(p.sub)}deg`, ...p.style }}
      role="img"
      aria-label={`Stamp: r/${p.sub}, ${p.caption}`}
    >
      <defs>
        <path id={`${uid}t`} d="M 75 75 m -58 0 a 58 58 0 1 1 116 0" />
        <path id={`${uid}b`} d="M 75 75 m -61 0 a 61 61 0 0 0 122 0" />
      </defs>
      <g filter="url(#ink-rough)" fill="currentColor">
        <circle cx="75" cy="75" r="70" fill="none" stroke="currentColor" strokeWidth="4" />
        <circle cx="75" cy="75" r="48" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text fontFamily="'Reddit Mono', monospace" fontWeight="800" fontSize={topSize} letterSpacing="1">
          <textPath href={`#${uid}t`} startOffset="50%" textAnchor="middle">
            {top}
          </textPath>
        </text>
        <text fontFamily="'Reddit Mono', monospace" fontWeight="600" fontSize={bottomSize} letterSpacing="1.5">
          <textPath href={`#${uid}b`} startOffset="50%" textAnchor="middle">
            {bottom}
          </textPath>
        </text>
      </g>
      <Mark sub={p.sub} uid={uid} color={color} cx={75} cy={75} r={42} nameWidth={80} />
    </svg>
  );
};

/** Small round mark used on tickets and lists: the community's icon (or name) in a ring. */
export const MiniStamp = ({ sub }: { sub: string }) => {
  const d = district(sub);
  const color = INK[d.id];
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg
      className="mini-stamp"
      viewBox="0 0 42 42"
      width={42}
      height={42}
      style={{ color, rotate: `${tiltOf(sub, 12)}deg` }}
      aria-hidden="true"
    >
      <circle cx="21" cy="21" r="19.5" fill="none" stroke="currentColor" strokeWidth="2" filter="url(#ink-rough)" />
      <Mark sub={sub} uid={uid} color={color} cx={21} cy={21} r={16} nameWidth={30} />
    </svg>
  );
};

/** Rectangular rubber stamp for notices: ARRIVED, BORDER CLOSED, DETOUR… */
export const BoxStamp = (p: {
  text: string;
  sub?: string;
  color?: string;
  className?: string;
  tilt?: number;
  style?: CSSProperties;
}) => (
  <span
    className={`box-stamp ${p.className ?? ''}`}
    style={{ color: p.color ?? '#b3261e', rotate: `${p.tilt ?? -8}deg`, ...p.style }}
  >
    <b>{p.text}</b>
    {p.sub && <small>{p.sub}</small>}
  </span>
);
