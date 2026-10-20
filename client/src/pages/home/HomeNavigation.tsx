import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import Button from "../../components/Button/Button";
import Icon from "../../components/Icon/Icon";
import { cn } from "../../utils/cnHelper";
import { buildShareableHashRouterUrl } from "../../utils/environment";

export const HOME_NAVIGATION_GRID_CLASS =
  "grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4";

export const HOME_TILE_CLASS =
  "flex h-full min-h-[84px] max-md:min-h-[84px] min-w-0 w-full items-center rounded-xl border border-gray-700/80 bg-gray-900/75 px-4 py-3 text-left text-white transition-colors hover:border-gray-500 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 active:bg-gray-800 sm:min-h-[96px]";

type HomeNavigationLinkProps = {
  title: string;
  to: string;
  icon: LucideIcon;
  iconColorClass: string;
  pending?: boolean;
};

export const HomeNavigationLink = ({
  title,
  to,
  icon,
  iconColorClass,
  pending = false,
}: HomeNavigationLinkProps) => {
  const navigate = useNavigate();
  const navigationTimeoutRef = useRef<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(
    () => () => {
      if (navigationTimeoutRef.current !== null) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
    },
    [],
  );

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    setIsPending(true);
    navigationTimeoutRef.current = window.setTimeout(() => {
      navigationTimeoutRef.current = null;
      navigate(to);
    }, 0);
  };

  const content = (
    <span className="flex w-full min-w-0 items-center gap-3.5">
      <span aria-hidden data-testid="home-navigation-icon" className={cn("shrink-0", iconColorClass)}>
        <Icon svg={icon} size="lg" className={iconColorClass} svgClassName={iconColorClass} />
      </span>
      <span className="min-w-0 flex-1 break-words text-base font-semibold leading-snug">
        {title}
      </span>
    </span>
  );

  if (pending) {
    return (
      <div className={cn(HOME_TILE_CLASS, "pointer-events-none border-gray-700/80 bg-gray-900/80")} aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <Button
      variant="none"
      to={to}
      component="link"
      aria-busy={isPending}
      isLoading={isPending}
      onClick={handleClick}
      className={cn(HOME_TILE_CLASS, isPending && "border-cyan-300/70 bg-gray-800 ring-2 ring-cyan-400/30")}
      wrap
    >
      {content}
    </Button>
  );
};

type HomeNavigationSectionProps = {
  title: string;
  icon?: LucideIcon;
  iconColorClass?: string;
  children: ReactNode;
  className?: string;
  busy?: boolean;
};

export const HomeNavigationSection = ({
  title,
  icon: SectionIcon,
  iconColorClass = "text-gray-400",
  children,
  className,
  busy = false,
}: HomeNavigationSectionProps) => (
  <section
    className={cn(
      "w-full space-y-4 rounded-xl border border-gray-700/75 bg-gray-900/40 p-4 sm:p-5",
      className,
    )}
    aria-label={title}
    aria-busy={busy || undefined}
  >
    <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-wide text-gray-100 sm:text-lg">
      {SectionIcon ? (
        <SectionIcon aria-hidden className={cn("h-5 w-5", iconColorClass)} />
      ) : null}
      {title}
    </h2>
    {children}
  </section>
);

type HomeOutputLinkCardProps = {
  title: string;
  to: string | null;
  icon: LucideIcon;
  iconColorClass: string;
  pending?: boolean;
};

export const HomeOutputLinkCard = ({
  title,
  to,
  icon,
  iconColorClass,
  pending = false,
}: HomeOutputLinkCardProps) => {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current);
    },
    [],
  );

  const copyLink = async () => {
    if (!to || pending || copyState === "copying") return;
    setCopyState("copying");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(buildShareableHashRouterUrl(to));
      setCopyState("copied");
      if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
      if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = window.setTimeout(() => setCopyState("idle"), 2800);
    }
  };

  const disabled = pending || !to;
  return (
    <div
      className={cn(
        HOME_TILE_CLASS,
        "relative gap-2",
        pending && "pointer-events-none border-gray-700/80 bg-gray-900/80",
      )}
      aria-disabled={disabled || undefined}
    >
      {to && !pending ? (
        <Link
          to={to}
          aria-label={`Open ${title}`}
          className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        />
      ) : null}
      <span className="pointer-events-none relative z-0 flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden className={cn("shrink-0", iconColorClass)}>
          <Icon svg={icon} size="lg" className={iconColorClass} svgClassName={iconColorClass} />
        </span>
        <span className="min-w-0 flex-1 break-words text-base font-semibold leading-snug">
          {title}
        </span>
      </span>
      <Button
        type="button"
        variant="tertiary"
        disabled={disabled || copyState === "copying"}
        aria-label={
          copyState === "copied"
            ? `Copied ${title} link`
            : `Copy ${title} link`
        }
        aria-busy={copyState === "copying"}
        isLoading={copyState === "copying"}
        onClick={() => void copyLink()}
        className={cn(
          "relative z-10 h-11 min-h-11 w-11 shrink-0 p-0",
          copyState === "copied" && "text-emerald-300",
          copyState === "error" && "text-red-300",
        )}
        svg={copyState === "copied" ? Check : copyState === "error" ? AlertCircle : Copy}
        iconSize="sm"
      >
        <span className="sr-only">{copyState === "copied" ? "Copied" : "Copy link"}</span>
      </Button>
      {copyState === "copied" ? (
        <span role="status" className="sr-only">Link copied for {title}.</span>
      ) : copyState === "error" ? (
        <span role="alert" className="sr-only">Couldn't copy the link for {title}.</span>
      ) : null}
    </div>
  );
};
