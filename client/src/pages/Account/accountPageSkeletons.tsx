import type { ReactNode } from "react";
import { cn } from "../../utils/cnHelper";

const skeletonBar = "animate-pulse rounded bg-white/10";
const cardClassName =
  "rounded-xl border border-gray-700 bg-gray-950/50 p-4 space-y-4";

const SkeletonStatus = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div
    className="space-y-4"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label={label}
  >
    {children}
  </div>
);

const SkeletonSectionHeader = () => (
  <div className="space-y-2">
    <div className={cn(skeletonBar, "h-6 w-40")} />
    <div className={cn(skeletonBar, "h-4 w-full max-w-xl")} />
    <div className={cn(skeletonBar, "h-4 w-5/6 max-w-lg")} />
  </div>
);

const SkeletonListRows = ({ count = 3 }: { count?: number }) => (
  <div className="space-y-2">
    {Array.from({ length: count }, (_, index) => (
      <div
        key={index}
        className="flex flex-col gap-3 rounded-lg bg-gray-900/40 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className={cn(skeletonBar, "h-4 w-48")} />
          <div className={cn(skeletonBar, "h-3 w-64 max-w-full")} />
          <div className={cn(skeletonBar, "h-3 w-40")} />
        </div>
        <div className={cn(skeletonBar, "h-9 w-24 shrink-0")} />
      </div>
    ))}
  </div>
);

const SkeletonFormRow = () => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
    <div className="min-w-0 flex-1 space-y-2">
      <div className={cn(skeletonBar, "h-3 w-16")} />
      <div className={cn(skeletonBar, "h-10 w-full")} />
    </div>
    <div className="min-w-0 flex-1 space-y-2">
      <div className={cn(skeletonBar, "h-3 w-16")} />
      <div className={cn(skeletonBar, "h-10 w-full")} />
    </div>
    <div className={cn(skeletonBar, "h-10 w-28 shrink-0")} />
  </div>
);

export const AccountPeoplePageSkeleton = () => (
  <SkeletonStatus label="Loading people">
    <section className={cardClassName}>
      <SkeletonSectionHeader />
      <SkeletonFormRow />
    </section>
    <section className={cardClassName}>
      <SkeletonSectionHeader />
      <SkeletonListRows count={2} />
    </section>
    <section className={cardClassName}>
      <SkeletonSectionHeader />
      <SkeletonListRows count={4} />
    </section>
  </SkeletonStatus>
);

export const AccountSetupPageSkeleton = () => (
  <SkeletonStatus label="Loading devices and security">
    {Array.from({ length: 4 }, (_, index) => (
      <section key={index} className={cardClassName}>
        <SkeletonSectionHeader />
        {index < 2 ? (
          <>
            <SkeletonFormRow />
            <SkeletonListRows count={index === 0 ? 2 : 1} />
          </>
        ) : (
          <SkeletonListRows count={index === 2 ? 3 : 2} />
        )}
      </section>
    ))}
  </SkeletonStatus>
);

export const AccountBrandingPageSkeleton = () => (
  <SkeletonStatus label="Loading branding">
    <section className={cardClassName}>
      <SkeletonSectionHeader />
      <div className="grid gap-4 md:grid-cols-2">
        <div className={cn(skeletonBar, "h-28 w-full")} />
        <div className={cn(skeletonBar, "h-28 w-full")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className={cn(skeletonBar, "h-24 w-full")} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className={cn(skeletonBar, "h-10 w-28")} />
        <div className={cn(skeletonBar, "h-10 w-24")} />
      </div>
    </section>
  </SkeletonStatus>
);

export const AccountIntegrationsPageSkeleton = () => (
  <SkeletonStatus label="Loading integrations">
    <section className={cardClassName}>
      <SkeletonSectionHeader />
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className={cn(skeletonBar, "h-24 w-full")} />
        ))}
      </div>
    </section>
    <section className={cardClassName}>
      <SkeletonSectionHeader />
      <SkeletonFormRow />
      <SkeletonListRows count={2} />
    </section>
  </SkeletonStatus>
);

export const AccountSectionRouteSkeleton = () => (
  <div className="space-y-4">
    <div className="flex flex-col gap-3 border-b border-gray-700/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <div className={cn(skeletonBar, "h-8 w-44")} />
        <div className={cn(skeletonBar, "h-4 w-full max-w-xl")} />
      </div>
      <div className={cn(skeletonBar, "h-7 w-28 shrink-0 rounded-full")} />
    </div>
    <AccountPeoplePageSkeleton />
  </div>
);
