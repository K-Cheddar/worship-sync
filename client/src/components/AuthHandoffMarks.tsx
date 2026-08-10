import { ArrowRight } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  GoogleMark,
  MicrosoftMark,
  RestreamMark,
  YouTubeMark,
} from "./AuthProviderMarks";

export type AuthHandoffProvider =
  | "google"
  | "microsoft"
  | "youtube"
  | "restream";

const PROVIDER_LABEL: Record<AuthHandoffProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  youtube: "YouTube",
  restream: "Restream",
};

const PROVIDER_MARK: Record<
  AuthHandoffProvider,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  google: GoogleMark,
  microsoft: MicrosoftMark,
  youtube: YouTubeMark,
  restream: RestreamMark,
};

type AuthHandoffMarksProps = {
  provider: AuthHandoffProvider;
  className?: string;
};

/**
 * Provider → WorshipSync visual for browser auth / connect completion screens.
 */
export const AuthHandoffMarks = ({
  provider,
  className = "",
}: AuthHandoffMarksProps) => {
  const ProviderMark = PROVIDER_MARK[provider];
  const label = `${PROVIDER_LABEL[provider]} to WorshipSync`;

  return (
    <div
      className={["mb-4 flex items-center justify-center gap-3", className]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={label}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white p-2 shadow-sm">
        <ProviderMark className="h-8 w-8" />
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
      <img
        src={`${import.meta.env.BASE_URL}logo192.png`}
        alt=""
        width={48}
        height={48}
        className="h-12 w-12 rounded-xl shadow-sm"
      />
    </div>
  );
};
