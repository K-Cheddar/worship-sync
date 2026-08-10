import type { SVGProps } from "react";

/** Multicolor Google "G" mark; path fills are fixed (not driven by Button `color`). */
export const GoogleMark = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

/** Microsoft four-square mark; path fills are fixed. */
export const MicrosoftMark = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 23 23" aria-hidden="true" {...props}>
    <path fill="#f25022" d="M1 1h10v10H1z" />
    <path fill="#7fba00" d="M12 1h10v10H12z" />
    <path fill="#00a4ef" d="M1 12h10v10H1z" />
    <path fill="#ffb900" d="M12 12h10v10H12z" />
  </svg>
);

/** YouTube play-button mark; path fills are fixed. */
export const YouTubeMark = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <path
      fill="#FF0033"
      d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8z"
    />
    <path fill="#fff" d="M9.75 15.5v-7l6 3.5-6 3.5z" />
  </svg>
);

/** Compact Restream-style mark for auth handoff screens. */
export const RestreamMark = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <rect width="24" height="24" rx="6" fill="#6C5CE7" />
    <path
      fill="#fff"
      d="M7.5 7.25h3.1c2.55 0 4.15 1.45 4.15 3.55 0 2.1-1.6 3.55-4.15 3.55H9.75V16.75H7.5V7.25zm2.95 2.1H9.75v2.85h.7c1.05 0 1.7-.55 1.7-1.45s-.65-1.4-1.7-1.4z"
    />
  </svg>
);
