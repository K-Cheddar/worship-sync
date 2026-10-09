import { useContext, useState } from "react";
import { Download, FileUp, MoreHorizontal } from "lucide-react";
import { GlobalInfoContext } from "@/context/globalInfo";
import type { PortableDataType, TeamRecord } from "../../api/authTypes";
import Button from "@/components/Button/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import PortableDataImportDialog from "./PortableDataImportDialog";
import { downloadPortableCsv } from "./portableDataTransfer";

const PortableDataActions = ({
  type,
  onImported,
  teams,
  destinationTeamId,
}: {
  type: PortableDataType;
  onImported?: () => void | Promise<void>;
  teams?: TeamRecord[];
  destinationTeamId?: string;
}) => {
  const { churchId, role } = useContext(GlobalInfoContext) || {};
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (role !== "admin" || !churchId) return null;

  const exportCsv = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await downloadPortableCsv(churchId, type);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not download this file. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="tertiary" aria-label="More data options">
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setImportOpen(true)}>
            <FileUp className="mr-2 size-4" aria-hidden />
            Import CSV…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => void exportCsv()}>
            <Download className="mr-2 size-4" aria-hidden />
            {busy ? "Preparing CSV…" : "Export CSV"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {message ? <span role="status" className="sr-only">{message}</span> : null}
      <PortableDataImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        churchId={churchId}
        type={type}
        teams={teams}
        destinationTeamId={destinationTeamId}
        onImported={onImported}
      />
    </>
  );
};

export default PortableDataActions;
