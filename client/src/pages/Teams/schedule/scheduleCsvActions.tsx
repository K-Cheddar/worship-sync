import type { Dispatch, SetStateAction } from "react";
import type { MenuItemType } from "../../../types";
import { downloadPortableCsv } from "../../../components/PortableDataTransfer/portableDataTransfer";

export const createScheduleCsvMenuItems = ({
  churchId,
  onImport,
  onExportError,
  exportBusy,
  setExportBusy,
}: {
  churchId: string;
  onImport: () => void;
  onExportError: (error: unknown) => void;
  exportBusy: boolean;
  setExportBusy: Dispatch<SetStateAction<boolean>>;
}): MenuItemType[] => [
  {
    text: "Import CSV…",
    onClick: onImport,
  },
  {
    element: (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>Export CSV</span>
        <span className="text-xs text-gray-400">All schedules</span>
      </span>
    ),
    disabled: exportBusy,
    onClick: () => {
      if (exportBusy) return;
      setExportBusy(true);
      void downloadPortableCsv(churchId, "schedules")
        .catch(onExportError)
        .finally(() => setExportBusy(false));
    },
  },
];
