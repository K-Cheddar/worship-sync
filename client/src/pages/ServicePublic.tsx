import { RefreshCw } from "lucide-react";
import { useParams } from "react-router-dom";
import Button from "../components/Button/Button";
import Spinner from "../components/Spinner/Spinner";
import { usePublicServiceFlow } from "../services/usePublicServiceFlow";
import { cn } from "../utils/cnHelper";
import { publicPageScrollClassName } from "./Teams/teamsStyles";
import ServicePublicView from "./ServicePublicView";

const pageShellClassName = cn(publicPageScrollClassName, "bg-neutral-950 text-neutral-100");

const ServicePublic = () => {
  const { shareId = "" } = useParams();
  const { snapshot, error, loading, connection, revoked, refresh } = usePublicServiceFlow(shareId);

  if (loading && !snapshot) {
    return (
      <main className={cn(pageShellClassName, "flex items-center justify-center p-6")}>
        <div className="flex items-center gap-3" aria-live="polite">
          <Spinner width="24px" borderWidth="3px" /> Loading service…
        </div>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className={cn(pageShellClassName, "flex items-center justify-center p-6")}>
        <div className="max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-center shadow-xl">
          <h1 className="text-xl font-semibold">
            {revoked ? "This service is no longer shared" : "Service unavailable"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-300">
            {revoked
              ? "The link has been turned off or the service was removed. Ask your team for a new link."
              : error || "This service is not available."}
          </p>
          <Button variant="cta" svg={RefreshCw} className="mt-5" onClick={() => void refresh(true)}>Try again</Button>
        </div>
      </main>
    );
  }

  return (
    <ServicePublicView
      snapshot={snapshot}
      connection={connection}
      error={error}
      onRefresh={() => void refresh()}
    />
  );
};

export default ServicePublic;
