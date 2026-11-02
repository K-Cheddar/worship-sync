import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import Button from "../../components/Button/Button";
import Icon from "../../components/Icon/Icon";
import type { EntityIcon } from "../../components/icons/iconTypes";
import { cn } from "../../utils/cnHelper";
import { buildShareableHashRouterUrl } from "../../utils/environment";

export const HOME_NAVIGATION_GRID_CLASS =
  "grid auto-rows-fr grid-cols-2 gap-2 md:grid-cols-3 md:gap-3 lg:grid-cols-4";

export const HOME_TILE_CLASS =
  "flex h-full min-h-[48px] min-w-0 w-full items-center rounded-2xl border border-gray-600 bg-gray-900 px-0 py-0 text-left text-white transition-colors duration-150 hover:border-gray-500 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 active:translate-y-px max-sm:!min-h-[48px] sm:min-h-[82px]";

export const HOME_TILE_DESCRIPTION_SIZE_CLASS =
  "min-h-[48px] max-sm:!min-h-[48px] sm:min-h-[82px]";

export const HOME_TILE_CONTENT_CLASS =
  "flex w-full min-w-0 items-center px-[8px] sm:px-4";

export const HOME_TILE_ICON_CLASS =
  "flex h-12 w-8 shrink-0 items-center justify-center rounded-xl sm:h-14";

const LazyWorshipSyncIcon = lazy(() => import("../../components/icons/WorshipSyncIcon"));

type HomeNavigationLinkProps = {
  title: string;
  to: string;
  icon: LucideIcon;
  iconColorClass: string;
  iconRef?: EntityIcon;
  description?: string;
  showDescriptions?: boolean;
  pending?: boolean;
};

export const HomeNavigationLink = ({
  title,
  to,
  icon,
  iconColorClass,
  iconRef,
  description,
  showDescriptions = false,
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
    <span className={cn(HOME_TILE_CONTENT_CLASS, "gap-3 py-[8px] sm:py-0")}>
      <span
        aria-hidden
        data-testid="home-navigation-icon"
        className={cn(HOME_TILE_ICON_CLASS, iconColorClass)}
      >
        {iconRef ? (
          <Suspense fallback={<Icon svg={icon} size="xl" className={iconColorClass} svgClassName={iconColorClass} />}>
            <LazyWorshipSyncIcon
              icon={iconRef}
              className="h-7 w-7"
              fallback={<Icon svg={icon} size="xl" className={iconColorClass} svgClassName={iconColorClass} />}
            />
          </Suspense>
        ) : (
          <Icon svg={icon} size="xl" className={iconColorClass} svgClassName={iconColorClass} />
        )}
      </span>
      {showDescriptions && description ? (
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[15px] font-semibold leading-snug tracking-[-0.01em] sm:text-[17px]">
            {title}
          </span>
          <span className="mt-[5px] block break-words text-xs font-normal leading-snug text-gray-400 sm:mt-0.5">
            {description}
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug tracking-[-0.01em] sm:text-[17px]">
          {title}
        </span>
      )}
    </span>
  );

  if (pending) {
    return (
      <div
        className={cn(
          HOME_TILE_CLASS,
          showDescriptions && HOME_TILE_DESCRIPTION_SIZE_CLASS,
          "pointer-events-none border-gray-700 bg-gray-900",
        )}
        aria-disabled="true"
      >
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
      className={cn(
        HOME_TILE_CLASS,
        showDescriptions && HOME_TILE_DESCRIPTION_SIZE_CLASS,
        isPending && "border-cyan-300/70 ring-2 ring-cyan-400/30",
      )}
      wrap
    >
      {content}
    </Button>
  );
};

type HomeNavigationSectionProps = {
  title: string;
  description?: string;
  showDescriptions?: boolean;
  icon?: LucideIcon;
  iconColorClass?: string;
  children: ReactNode;
  className?: string;
  busy?: boolean;
};

type HomeSectionHeadingProps = {
  title: string;
  description?: string;
  showDescriptions?: boolean;
  icon?: LucideIcon;
  iconColorClass?: string;
  className?: string;
  as?: "h2" | "span";
};

export const HomeSectionHeading = ({
  title,
  description,
  showDescriptions = false,
  icon: SectionIcon,
  iconColorClass = "text-gray-400",
  className,
  as = "h2",
}: HomeSectionHeadingProps) => {
  const HeadingElement = as;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <HeadingElement
        {...(as === "span" ? { role: "heading" as const, "aria-level": 2 } : {})}
        className="flex min-w-0 items-center gap-3 text-lg font-semibold tracking-[-0.015em] text-slate-50 sm:text-xl"
      >
        {SectionIcon ? (
          <SectionIcon aria-hidden className={cn("h-6 w-6 shrink-0", iconColorClass)} />
        ) : null}
        <span className="min-w-0 break-words">{title}</span>
      </HeadingElement>
      {showDescriptions && description ? (
        <p className="min-w-0 basis-full pl-9 text-sm leading-snug text-gray-400 md:flex-1 md:basis-0 md:pl-0">
          {description}
        </p>
      ) : null}
    </div>
  );
};

export const HomeNavigationSection = ({
  title,
  description,
  showDescriptions = false,
  icon: SectionIcon,
  iconColorClass = "text-gray-400",
  children,
  className,
  busy = false,
}: HomeNavigationSectionProps) => (
  <section
    className={cn(
      "w-full space-y-4 rounded-2xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5",
      className,
    )}
    aria-label={title}
    aria-busy={busy || undefined}
  >
    <HomeSectionHeading
      title={title}
      description={description}
      showDescriptions={showDescriptions}
      icon={SectionIcon}
      iconColorClass={iconColorClass}
    />
    {children}
  </section>
);

type HomeOutputLinkCardProps = {
  title: string;
  linkContext: "fullscreen" | "browser source";
  to: string | null;
  icon: LucideIcon;
  iconColorClass: string;
  pending?: boolean;
  showDescriptions?: boolean;
};

export const HomeOutputLinkCard = ({
  title,
  linkContext,
  to,
  icon,
  iconColorClass,
  pending = false,
  showDescriptions = false,
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
  const content = (
    <>
      <span
        aria-hidden
        className={cn(HOME_TILE_ICON_CLASS, iconColorClass)}
      >
        <Icon svg={icon} size="xl" className={iconColorClass} svgClassName={iconColorClass} />
      </span>
      <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug tracking-[-0.01em] sm:text-[17px]">
        {title}
      </span>
    </>
  );

  return (
    <div
      className={cn(
        HOME_TILE_CLASS,
        showDescriptions && HOME_TILE_DESCRIPTION_SIZE_CLASS,
        "gap-0 overflow-hidden py-0 hover:border-gray-600 hover:bg-gray-900",
        pending && "pointer-events-none border-gray-700 bg-gray-900",
      )}
      aria-disabled={disabled || undefined}
    >
      {to && !pending ? (
        <Link
          to={to}
          aria-label={`Open ${title} ${linkContext} link`}
          className={cn(
            "relative z-0 flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-l-2xl px-4 text-left transition-colors hover:bg-gray-800 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300",
            "px-[8px] py-[8px] sm:px-4 sm:py-3",
          )}
        >
          {content}
        </Link>
      ) : (
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 self-stretch px-4",
            "px-[8px] py-[8px] sm:px-4 sm:py-3",
          )}
        >
          {content}
        </span>
      )}
      <Button
        type="button"
        variant="none"
        disabled={disabled || copyState === "copying"}
        aria-label={
          copyState === "copied"
            ? `Copied ${title} ${linkContext} link`
            : `Copy ${title} ${linkContext} link`
        }
        aria-busy={copyState === "copying"}
        isLoading={copyState === "copying"}
        onClick={() => void copyLink()}
        className={cn(
          "relative z-10 flex min-h-full w-12 shrink-0 self-stretch items-center justify-center gap-0 rounded-none border-0 border-l border-gray-600 bg-transparent p-0 text-white transition-colors hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300",
          copyState === "copied" && "text-emerald-300",
          copyState === "error" && "text-red-300",
        )}
        svg={copyState === "copied" ? Check : copyState === "error" ? AlertCircle : Copy}
        iconSize="sm"
      >
        <span className="sr-only">{copyState === "copied" ? "Copied" : "Copy link"}</span>
      </Button>
      {copyState === "copied" ? (
        <span role="status" className="sr-only">Link copied for {title} {linkContext}.</span>
      ) : copyState === "error" ? (
        <span role="alert" className="sr-only">Couldn't copy the {linkContext} link for {title}.</span>
      ) : null}
    </div>
  );
};
