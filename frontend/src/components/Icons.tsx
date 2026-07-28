// Inline SVG icons, replacing the Font Awesome CDN in the mockup.
//
// ~2KB for the icons we actually use, versus a ~75KB render-blocking stylesheet plus a webfont
// from cdnjs. Also keeps the app at zero external requests, which matters for offline dev and
// for not handing a third party a request log of every page view.
//
// All paths are 24x24, stroke-based, and inherit currentColor.

import type { SVGProps } from "react";

export type IconName =
  | "home" | "chart" | "globe" | "wallet" | "trophy" | "users" | "gift" | "more"
  | "bolt" | "shield" | "clock" | "sliders" | "search" | "bell" | "star" | "star-filled"
  | "arrow-right" | "arrow-up-right" | "chevron-down" | "eye" | "warning" | "docs";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  chart: <path d="M3 3v18h18M7 15l3.5-4 3 2.5L20 7" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M16 12h2" /></>,
  trophy: <><path d="M8 4h8v6a4 4 0 0 1-8 0z" /><path d="M8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M10 20h4M12 14v6" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5M17 20a6 6 0 0 0-2-4.5" /></>,
  gift: <><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13" /><path d="M12 7S10.5 3 8 3a2 2 0 0 0 0 4M12 7s1.5-4 4-4a2 2 0 0 1 0 4" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5-4.5-1-8-4.5-8-9.5V6z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  sliders: <path d="M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />,
  "star-filled": <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor" />,
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  "arrow-up-right": <path d="M7 17 17 7M8 7h9v9" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.5" /></>,
  warning: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17v.01" /></>,
  docs: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
};

interface Props extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Brand marks. Kept separate from Icon — these are filled logos, not stroked UI glyphs. */
export function SocialIcon({ name, size = 15 }: { name: "x" | "discord" | "telegram" | "medium"; size?: number }) {
  const paths: Record<string, string> = {
    x: "M18.9 2H22l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3l7.3-8.3L2.3 2h6.4l4.4 5.9zM17.8 20.1h1.7L8.3 3.8H6.4z",
    discord: "M19.3 5.3A17 17 0 0 0 15 4l-.2.4a15.7 15.7 0 0 1 3.8 1.2 13.3 13.3 0 0 0-13.2 0A15.7 15.7 0 0 1 9.2 4.4L9 4a17 17 0 0 0-4.3 1.3C2 9.3 1.3 13.2 1.6 17a17 17 0 0 0 5.2 2.6l1-1.7a11 11 0 0 1-1.7-.8l.4-.3a12.2 12.2 0 0 0 10.9 0l.4.3a11 11 0 0 1-1.7.8l1 1.7a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.3-2.9-11.7zM8.4 14.6c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1zm7.2 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z",
    telegram: "M21.9 4.3 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6 11.9l-4.9-1.5c-1.1-.3-1.1-1 .2-1.5l19.2-7.4c.9-.3 1.7.2 1.4 2.8z",
    medium: "M2.8 7.4c0-.3-.1-.5-.3-.7L.8 4.6v-.3h5.6l4.3 9.5 3.8-9.5H20v.3l-1.4 1.4c-.1.1-.2.2-.2.4v10c0 .2.1.3.2.4l1.4 1.3v.3h-6.9v-.3l1.4-1.4c.1-.1.1-.2.1-.4V9.2l-4 10.1h-.5L5.5 9.2v6.8c0 .3.1.6.3.8l1.9 2.3v.3H2.3v-.3l1.9-2.3c.2-.2.3-.5.3-.8z",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
