import { useMemo } from "react";
import ElectronMediaSurfacePool from "../../components/DisplayWindow/ElectronMediaSurfacePool";
import { useResourceGovernorPolicy } from "../../hooks/useResourceGovernorPolicy";
import type { ServiceVideoCandidateResult } from "../../hooks/useServiceVideoCandidates";
import {
  selectElectronMediaCandidatesForResourcePolicy,
} from "../../utils/electronMediaSurfacePool";

type ControllerLocalMediaPreparationHostProps = {
  currentItemId?: string;
  discoveryResult: ServiceVideoCandidateResult;
};

/** Keeps the controller's bounded local service preparation pool alive across routes. */
const ControllerLocalMediaPreparationHost = ({
  currentItemId,
  discoveryResult,
}: ControllerLocalMediaPreparationHostProps) => {
  const resourcePolicy = useResourceGovernorPolicy();
  const candidates = useMemo(
    () =>
      selectElectronMediaCandidatesForResourcePolicy({
        candidates: discoveryResult.allCandidates,
        currentItemId,
        baseBudget: discoveryResult.poolCapacity,
        aggressiveness:
          resourcePolicy?.recommendations.distantMediaPreparation ?? "normal",
        performanceClass: discoveryResult.performanceClass,
      }),
    [
      currentItemId,
      discoveryResult.allCandidates,
      discoveryResult.performanceClass,
      discoveryResult.poolCapacity,
      resourcePolicy?.recommendations.distantMediaPreparation,
    ],
  );
  const discovery = useMemo(
    () => ({
      ...discoveryResult.discovery,
      renderer: "editor" as const,
      currentItemId,
    }),
    [currentItemId, discoveryResult.discovery],
  );
  const candidateDiagnostics = useMemo(
    () =>
      discoveryResult.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        isCurrentItem: diagnostic.itemId === currentItemId,
      })),
    [currentItemId, discoveryResult.diagnostics],
  );

  if (!window.electronAPI) return null;

  return (
    <ElectronMediaSurfacePool
      enabled
      candidates={candidates}
      candidateDiagnostics={candidateDiagnostics}
      views={[]}
      route="editor"
      role="controller-service-preparation"
      outlineId={discovery.targetOutlineId}
      preparationSource="local-pouchdb"
      discovery={discovery}
      poolCapacity={discoveryResult.poolCapacity}
      performanceClass={discoveryResult.performanceClass}
      outputId={undefined}
      windowRole="local-preparation"
    />
  );
};

export default ControllerLocalMediaPreparationHost;
