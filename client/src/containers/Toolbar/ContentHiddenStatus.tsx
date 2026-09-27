import { EyeOff } from "lucide-react";
import { shallowEqual } from "react-redux";
import { useContext } from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useActiveControllerProfile } from "../../context/activeController";
import { useSelector } from "../../hooks";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import {
  selectOutputSlot,
} from "../../store/presentationSlice";
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
  const blockedByOutput = useSelector((state) => {
    return targets.filter(
      (id) => selectOutputSlot(state, id, "stream").itemContentBlocked,
    );
  }, shallowEqual);

  if (
    !globalInfo?.sharedDataReady ||
    !globalInfo.realtimeConnected ||
    blockedByOutput.length === 0
  ) {
    return null;
  }

  const names = blockedByOutput.map(
    (id) => outputs.find((output) => output.id === id)?.name ?? id,
  );
  const title = `Content Hidden on ${names.join(", ")}`;
  const targetLabel =
    names.length <= 2 ? names.join(", ") : `${names.length} streams`;

  return (
    <div
      role="status"
      aria-label={title}
      title={title}
      className="sticky right-0 z-20 inline-flex h-8 shrink-0 items-center gap-1.5 rounded bg-amber-950/95 px-2 text-xs font-semibold text-amber-100 ring-1 ring-amber-300/40"
    >
      <EyeOff aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">Content Hidden</span>
      <span className="hidden max-w-36 truncate text-amber-200 sm:inline">
        {targetLabel}
      </span>
    </div>
  );
};

export default ContentHiddenStatus;
