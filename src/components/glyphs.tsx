// The drawings used on the page. All are decoration: the words next to them carry the meaning,
// so every drawing is hidden from screen readers.
import type { SVGProps } from 'react';

type GlyphProps = SVGProps<SVGSVGElement>;

const base = { 'aria-hidden': true, focusable: false } as const;

/** Magnifying glass, in cyan with a darker edge so it stands out on a light disc. */
export function MagnifierGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 96 96" {...base} {...props}>
      <path d="M60 60l22 22" fill="none" stroke="#0e7490" strokeWidth="16" strokeLinecap="round" />
      <path d="M61 61l20 20" fill="none" stroke="#27c2d0" strokeWidth="8" strokeLinecap="round" />
      <circle cx="41" cy="41" r="26" fill="#e3f8fa" stroke="#0e7490" strokeWidth="13" />
      <circle cx="41" cy="41" r="26" fill="none" stroke="#27c2d0" strokeWidth="7" />
      <path d="M28 40a14 14 0 0 1 11-12" fill="none" stroke="#27c2d0" strokeWidth="4.5" strokeLinecap="round" opacity=".8" />
    </svg>
  );
}

/** Bell, in red. */
export function BellGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 96 96" {...base} {...props}>
      <path
        d="M48 10a6 6 0 0 0-6 6v2.6C30.8 21.4 23 31.3 23 43v17.5l-7.4 9.9A3 3 0 0 0 18 75h60a3 3 0 0 0 2.4-4.8L73 60.5V43c0-11.7-7.8-21.6-19-24.4V16a6 6 0 0 0-6-6z"
        fill="#b42318"
      />
      <path d="M38 80a10 10 0 0 0 20 0z" fill="#b42318" />
      <path d="M32 44c0-7.5 4.3-13.8 10.5-16.3" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity=".45" />
    </svg>
  );
}

/** Letter (an envelope), in yellow with a dark gold edge. */
export function LetterGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 96 96" {...base} {...props}>
      <rect x="9" y="21" width="78" height="56" rx="9" fill="#edbf67" stroke="#9a6200" strokeWidth="5" />
      <path d="M12 28l36 28 36-28" fill="#f7dc9b" stroke="#9a6200" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 72l23-21M83 72L60 51" fill="none" stroke="#9a6200" strokeWidth="3.5" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

function Line(props: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.15em"
      height="1.15em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...base}
      {...props}
    />
  );
}

export function CloseIcon(props: GlyphProps) {
  return (
    <Line {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Line>
  );
}

export function BackIcon(props: GlyphProps) {
  return (
    <Line {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Line>
  );
}

export function CheckIcon(props: GlyphProps) {
  return (
    <Line {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Line>
  );
}

export function PrintIcon(props: GlyphProps) {
  return (
    <Line {...props}>
      <path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z" />
    </Line>
  );
}

export function MailIcon(props: GlyphProps) {
  return (
    <Line {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </Line>
  );
}

export function CopyIcon(props: GlyphProps) {
  return (
    <Line {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </Line>
  );
}

export function UploadIcon(props: GlyphProps) {
  return (
    <Line {...props}>
      <path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14" />
    </Line>
  );
}

export function AlertIcon(props: GlyphProps) {
  return (
    <Line {...props}>
      <path d="M12 4l9 16H3zM12 10v4.5M12 17.5v.01" />
    </Line>
  );
}
