import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ToolbarButton from "./ToolbarButton";
import Modal from "../../../components/Modal/Modal";
import Input from "../../../components/Input/Input";
import Button from "../../../components/Button/Button";
import { useToast } from "../../../context/toastContext";
import { useServicePlanningSync } from "../../../hooks/useServicePlanningSync";

type ServicePlanningToolbarControlsProps = {
  /** When false, component renders nothing (caller decides visibility). */
  showTrigger: boolean;
};

const ServicePlanningToolbarControls = ({
  showTrigger,
}: ServicePlanningToolbarControlsProps) => {
  const { showToast } = useToast();
  const { runServicePlanningSync } = useServicePlanningSync();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setUrl("");
  }, [open]);

  const handleSync = useCallback(async () => {
    if (!url.trim().toLowerCase().startsWith("https://")) {
      showToast("URL must start with https://", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await runServicePlanningSync(url.trim());
      if (result.updated > 0) {
        showToast(
          `Updated ${result.updated} overlay${result.updated === 1 ? "" : "s"}.${result.skipped ? ` Skipped ${result.skipped}.` : ""}`,
          "success",
        );
      } else if (result.skipped > 0 || result.reasons.length) {
        showToast(
          result.reasons[0] ||
          "No overlays matched your planning rows. Check rules and overlay event names.",
          "error",
        );
      } else {
        showToast("Nothing to update.", "success");
      }
      setOpen(false);
    } catch (e) {
      console.error(e);
      showToast(
        "Could not sync Service Planning. Check the URL and try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }, [runServicePlanningSync, showToast, url]);

  if (!showTrigger) return null;

  return (
    <>
      <ToolbarButton svg={RefreshCw} onClick={() => setOpen(true)}>
        Import Overlays
      </ToolbarButton>
      <Modal
        isOpen={open}
        onClose={() => !busy && setOpen(false)}
        title="Service Planning sync"
        description="Paste the Worship Planning printout URL. It must use https."
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Printout URL"
            value={url}
            onChange={(v) => setUrl(String(v || ""))}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="cta"
              isLoading={busy}
              disabled={busy || !url.trim()}
              onClick={() => void handleSync()}
            >
              Sync
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ServicePlanningToolbarControls;
