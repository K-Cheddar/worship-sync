type LocalSourceStatusProps = {
  sourceLabel: string;
  ownerLabel?: string;
  heading?: string;
  detail?: string;
  transparentBackground?: boolean;
};

/** Compact render-only status for operator previews of a source on another device. */
const LocalSourceStatus = ({
  sourceLabel,
  ownerLabel,
  heading = "Local source on another device",
  detail,
  transparentBackground = false,
}: LocalSourceStatusProps) => (
  <div
    className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center text-white ${transparentBackground ? "bg-transparent" : "bg-black"}`}
    role="status"
  >
    <p className="text-sm font-semibold">{heading}</p>
    <p className="text-xs leading-tight text-neutral-300">{sourceLabel}</p>
    {ownerLabel ? (
      <p className="text-xs leading-tight text-neutral-400">
        Available on {ownerLabel}
      </p>
    ) : null}
    {detail ? (
      <p className="text-xs leading-tight text-neutral-400">{detail}</p>
    ) : null}
  </div>
);

export default LocalSourceStatus;
