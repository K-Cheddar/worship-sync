import { EyeOff } from "lucide-react";
import { shallowEqual } from "react-redux";
import { useContext } from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useActiveControllerProfile } from "../../context/activeController";
import { useSelector } from "../../hooks";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { getControllerOutputs } from "../../utils/controllerProfiles";

/** Shared operator status for stream outputs this controller can target. */
const ContentHiddenStatus = () => {
  const globalInfo = useContext(GlobalInfoContext);
  const profile = useActiveControllerProfile();
  const outputs = useSelector(selectDisplayOutputs);
  const targets = useSelector(
    () =>
      getControllerOutputs(profile, outputs)
        .filter((output) => output.type === "stream")
        .map((output) => output.id),
    shallowEqual,
  );
  const blockedByOutput = targets.filter(
    (id) => globalInfo?.contentHiddenByOutput?.[id]?.hidden,
  );

  if (blockedByOutput.length === 0) return null;

  const names = blockedByOutput.map(
    (id) => outputs.find((output) => output.id === id)?.name ?? id,
  );
  const confirmed = blockedByOutput.every(
    (id) =>
      globalInfo?.realtimeConnected &&
      globalInfo?.contentHiddenByOutput?.[id]?.confirmed,
  );
  const statusSuffix = confirmed
    ? ""
    : globalInfo?.realtimeConnected
      ? " · Syncing"
      : " · Offline";
  const title = `Content Hidden${statusSuffix} on ${names.join(", ")}`;
  const description = confirmed
    ? title
    : `${title}. Last known state; the remote stream state is unconfirmed.`;
  const targetLabel =
    names.length <= 2 ? names.join(", ") : `${names.length} streams`;

  return (
    <div
      role="status"
      data-testid="toolbar-status-area"
      aria-label={description}
      title={description}
      className={`z-20 inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-2 text-xs font-semibold text-amber-100 ring-1 ${confirmed ? "bg-amber-950/95 ring-amber-300/40" : "border border-dashed border-amber-300/60 bg-amber-950/70 ring-transparent"}`}
    >
      <EyeOff aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden md:inline">
        {`Content Hidden${statusSuffix}`}
      </span>
      <span className="hidden max-w-36 truncate text-amber-200 md:inline">
        {targetLabel}
      </span>
    </div>
  );
};

export default ContentHiddenStatus;
