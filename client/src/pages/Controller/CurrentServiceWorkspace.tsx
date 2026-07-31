import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ListChecks } from "lucide-react";
import { onValue, ref } from "firebase/database";
import HomeToolbarMenu from "../../components/HomeToolbarMenu/HomeToolbarMenu";
import { SectionTabs } from "../../components/SectionTabs/SectionTabs";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerSmClassName,
} from "../../components/ui/tabs";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import CreditsPreview from "../../containers/Credits/Credits";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";
import { useDispatch, useSelector } from "../../hooks";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { CreditsInfo, ServiceTime } from "../../types";
import { getTeamsBootstrap } from "../../api/auth";
import type { TeamPosition, TeamRecord } from "../../api/authTypes";
import ServicePlanEditor from "../Services/ServicePlanEditor";
import { toTeamService } from "../Teams/teamsUtils";
import { initiateLiveCredits } from "../../store/creditsSlice";
import { getChurchDataPath } from "../../utils/firebasePaths";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";
import { findCurrentServiceOccurrence } from "./currentServiceWorkspaceUtils";

type WorkspaceTab = "plan" | "displays" | "credits";
type PreviewTab = "displays" | "credits";

const WorkspacePage = ({
  children,
  service,
  serviceTimeText,
}: {
  children: ReactNode;
  service?: ServiceTime | null;
  serviceTimeText?: string | null;
}) => (
  <main className="flex h-dvh flex-col overflow-hidden bg-homepage-canvas p-3 text-white lg:p-4">
    <header className="mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-gray-700 bg-gray-900/60 px-3 py-2">
      <HomeToolbarMenu />
      {service &&
        (serviceTimeText === "0" ? (
          <p className="min-w-0 flex-1 truncate text-lg font-semibold">
            {service.name || "Service"} is live
          </p>
        ) : (
          serviceTimeText && (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <p className="min-w-0 truncate text-lg font-semibold">
                {service.name || "Service"}:
              </p>
              <div
                className="shrink-0 rounded-md border border-white/20 bg-gray-950 px-2.5 py-1 text-lg font-semibold tabular-nums tracking-tight"
                style={{ color: service.color || "#ffffff" }}
                aria-label={`Begins in ${serviceTimeText}`}
              >
                {serviceTimeText}
              </div>
            </div>
          )
        ))}
      <div className="ml-auto shrink-0">
        <UserSection />
      </div>
    </header>
    {children}
  </main>
);

const DisplaysPreview = ({ columns = 1 }: { columns?: 1 | 2 }) => (
  <div className="flex h-full min-h-0 flex-col">
    <TransmitHandler readOnly columns={columns} fillWidth />
  </div>
);

const CreditsPanel = ({ credits }: { credits: CreditsInfo[] }) => (
  <div className="h-full min-h-0">
    <CreditsPreview credits={credits} isPreview compact />
  </div>
);

const PreviewPanel = ({
  credits,
  value,
  onValueChange,
}: {
  credits: CreditsInfo[];
  value: PreviewTab;
  onValueChange: (value: PreviewTab) => void;
}) => (
  <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60">
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as PreviewTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="shrink-0 border-b border-gray-700 p-2">
        <TabsList
          variant="line"
          className={lineTabsListShellClassName}
          aria-label="Workspace preview"
        >
          <TabsTrigger value="displays" className={lineTabsTriggerSmClassName}>
            Displays
          </TabsTrigger>
          <TabsTrigger value="credits" className={lineTabsTriggerSmClassName}>
            Credits
          </TabsTrigger>
        </TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <div
          className={
            value === "displays" ? "flex h-full min-h-0 flex-col" : "hidden"
          }
          aria-hidden={value !== "displays"}
        >
          <DisplaysPreview columns={2} />
        </div>
        <div
          className={value === "credits" ? "h-full min-h-0" : "hidden"}
          aria-hidden={value !== "credits"}
        >
          <CreditsPanel credits={credits} />
        </div>
      </div>
    </Tabs>
  </section>
);

/**
 * A read-only-at-the-controller live workspace around the current scheduled
 * service. Editing the plan follows the user's Services edit permission.
 */
const CurrentServiceWorkspace = () => {
  const {
    canViewTeams,
    canEditServices,
    canEditTeams,
    churchId,
    firebaseDb,
    loginState,
  } = useContext(GlobalInfoContext) || {};
  const { setIsMobile } = useContext(ControllerInfoContext) || {};
  const dispatch = useDispatch();
  const serviceTimes = useSelector((state) => state.undoable.present.serviceTimes.list);
  const liveCredits = useSelector((state) => state.undoable.present.credits.liveCredits);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [tab, setTab] = useState<WorkspaceTab>("plan");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [rolePositions, setRolePositions] = useState<TeamPosition[]>([]);
  const [roleTeams, setRoleTeams] = useState<TeamRecord[]>([]);

  useEffect(() => {
    setIsMobile?.(!isDesktop);
  }, [isDesktop, setIsMobile]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!churchId || !canViewTeams || loginState === "guest") {
      setRolePositions([]);
      setRoleTeams([]);
      return;
    }
    let cancelled = false;
    getTeamsBootstrap(churchId)
      .then((bootstrap) => {
        if (cancelled) return;
        setRolePositions(bootstrap.positions || []);
        setRoleTeams(bootstrap.teams || []);
      })
      .catch(() => {
        if (!cancelled) {
          setRolePositions([]);
          setRoleTeams([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewTeams, churchId, loginState]);

  useEffect(() => {
    if (!firebaseDb || loginState === "guest") return;
    return onValue(
      ref(firebaseDb, getChurchDataPath(churchId || "", "credits", "publishedList")),
      (snapshot) => {
        const data = snapshot.val();
        dispatch(initiateLiveCredits(Array.isArray(data) ? data : []));
      },
    );
  }, [churchId, dispatch, firebaseDb, loginState]);

  const services = useMemo(() => serviceTimes.map(toTeamService), [serviceTimes]);
  const occurrence = useMemo(
    () => findCurrentServiceOccurrence(services, nowMs),
    [services, nowMs],
  );
  const service = useMemo(
    () => services.find((candidate) => candidate.serviceId === occurrence?.serviceId) || null,
    [occurrence?.serviceId, services],
  );
  const serviceTimeText = useNextServiceCountdownText(occurrence?.startsAt ?? null);

  const desktopPreviewTab: PreviewTab = tab === "credits" ? "credits" : "displays";

  if (!canViewTeams) {
    return (
      <WorkspacePage service={service} serviceTimeText={serviceTimeText}>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
          <section className="max-w-md rounded-xl border border-gray-700 bg-gray-900/80 p-6 text-center">
            <h2 className="text-lg font-semibold">Teams access required</h2>
            <p className="mt-2 text-sm text-gray-300">
              Ask a church admin for view or edit access to Teams and Services.
            </p>
          </section>
        </div>
      </WorkspacePage>
    );
  }

  if (!occurrence || !service) {
    return (
      <WorkspacePage service={service} serviceTimeText={serviceTimeText}>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
          <section className="max-w-md rounded-xl border border-gray-700 bg-gray-900/80 p-6 text-center">
            <ListChecks className="mx-auto size-8 text-cyan-300" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold">No current service scheduled</h2>
            <p className="mt-2 text-sm text-gray-300">
              Add a service time to open its plan here.
            </p>
          </section>
        </div>
      </WorkspacePage>
    );
  }

  const planEditor = (
    <ServicePlanEditor
      service={service}
      occurrence={occurrence}
      members={[]}
      positions={rolePositions}
      teams={roleTeams}
      canEdit={Boolean(canEditServices ?? canEditTeams)}
    />
  );

  if (!isDesktop) {
    return (
      <WorkspacePage service={service} serviceTimeText={serviceTimeText}>
        <SectionTabs<WorkspaceTab>
          value={tab}
          onValueChange={setTab}
          keepMounted
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          tabBarClassName="shrink-0 rounded-xl bg-transparent"
          tabsListClassName="shrink-0"
          triggerClassName="text-xs px-2.5 py-1.5"
          tabsContentClassName="mt-3 flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden"
          items={[
            {
              value: "plan",
              label: "Service plan",
              content: planEditor,
              contentClassName: "flex min-h-0 flex-1 flex-col overflow-hidden",
            },
            {
              value: "displays",
              label: "Displays",
              content: (
                <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                  <DisplaysPreview />
                </section>
              ),
              contentClassName: "flex min-h-0 flex-1 flex-col overflow-hidden",
            },
            {
              value: "credits",
              label: "Credits",
              content: (
                <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                  <CreditsPanel credits={liveCredits} />
                </section>
              ),
              contentClassName: "flex min-h-0 flex-1 flex-col overflow-hidden",
            },
          ]}
        />
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage service={service} serviceTimeText={serviceTimeText}>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] gap-4 overflow-hidden">
        <section className="flex min-h-0 flex-col overflow-hidden">
          {planEditor}
        </section>

        <PreviewPanel
          credits={liveCredits}
          value={desktopPreviewTab}
          onValueChange={setTab}
        />
      </div>
    </WorkspacePage>
  );
};

export default CurrentServiceWorkspace;
