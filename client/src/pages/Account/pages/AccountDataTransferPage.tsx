import { useState } from "react";
import { Download } from "lucide-react";
import Button from "../../../components/Button/Button";
import { useAccountPage } from "../AccountPageContext";
import { downloadPortableData } from "../../../api/auth";
import { downloadBlob } from "../../../components/PortableDataTransfer/portableDataTransfer";

const AccountDataTransferPage = () => {
  const { churchId } = useAccountPage();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await downloadPortableData(
        churchId,
        "all",
        false,
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      );
      downloadBlob(result.blob, result.filename);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not download the CSV files. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 text-white">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold">Data export</h2>
        <p className="max-w-3xl text-sm text-gray-300">Download members, teams, positions, services, and schedules as CSV files.</p>
      </header>
      <section className="border-t border-gray-700 pt-5">
        <Button type="button" svg={Download} disabled={busy} onClick={() => void handleDownload()}>
          {busy ? "Preparing CSV files…" : "Download all CSVs"}
        </Button>
        {message ? <p role="status" className="mt-3 text-sm text-amber-100">{message}</p> : null}
      </section>
    </div>
  );
};

export default AccountDataTransferPage;
