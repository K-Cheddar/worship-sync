import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/utils/cnHelper";

const CurrentMemberIdentityContext = createContext<string | null>(null);

export const CurrentMemberIdentityProvider = ({
  memberId,
  children,
}: {
  memberId: string | null | undefined;
  children: ReactNode;
}) => (
  <CurrentMemberIdentityContext.Provider
    value={typeof memberId === "string" && memberId ? memberId : null}
  >
    {children}
  </CurrentMemberIdentityContext.Provider>
);

export const useCurrentMemberId = () => useContext(CurrentMemberIdentityContext);

export const CurrentUserMemberIndicator = ({
  memberId,
  className,
}: {
  memberId?: string | null;
  className?: string;
}) => {
  const selfMemberId = useCurrentMemberId();
  if (!memberId || !selfMemberId || memberId !== selfMemberId) return null;

  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap rounded bg-cyan-300/10 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-cyan-200",
        className,
      )}
    >
      You
    </span>
  );
};

/** Keeps the plain display name separate from its identity-only UI badge. */
export const MemberNameWithIndicator = ({
  name,
  memberId,
  className,
  nameClassName,
  indicatorClassName,
}: {
  name: string;
  memberId?: string | null;
  className?: string;
  nameClassName?: string;
  indicatorClassName?: string;
}) => (
  <span
    data-testid="member-name-with-indicator"
    className={cn(
      "min-w-0 max-w-full items-baseline gap-1.5",
      className,
      "inline-flex",
    )}
  >
    <span className={cn("min-w-0 truncate", nameClassName)}>{name}</span>
    <CurrentUserMemberIndicator
      memberId={memberId}
      className={indicatorClassName}
    />
  </span>
);

export default CurrentUserMemberIndicator;
