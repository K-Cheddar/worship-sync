import { useLocation } from "react-router-dom";
import { FileQuestion } from "lucide-react";
import cn from "classnames";
import Button from "../../components/Button/Button";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { AccessType } from "../../context/globalInfo";

type ButtonType = {
  type: string;
  title: string;
  section: string;
  /** Full accessible name when the visible title is abbreviated. */
  ariaLabel?: string;
  action?: Function;
  access?: AccessType[];
};

const buttons: ButtonType[] = [
  {
    type: "bible",
    title: "Bible",
    section: "bible",
    access: ["full", "view"],
  },
  {
    type: "song",
    title: "Songs",
    section: "songs",
    access: ["full", "music", "view"],
  },
  {
    type: "overlays",
    title: "Overlays",
    section: "overlays",
    access: ["full", "view"],
  },
  {
    type: "free",
    title: "Custom",
    section: "free",
    access: ["full", "music", "view"],
  },
  {
    type: "timer",
    title: "Timers",
    section: "timers",
    access: ["full", "view"],
  },
  {
    type: "create",
    title: "New",
    ariaLabel: "Create new item",
    section: "create",
    access: ["full", "music"],
  },
];

const EditorButtons = ({ access }: { access?: AccessType }) => {
  const location = useLocation();

  const canShow = (b: ButtonType) =>
    Boolean(access && b.access?.includes(access));

  const isSelected = (section: string) =>
    location.pathname.replace("/controller/", "") === section;

  return (
    <ErrorBoundary>
      <div className="grid grid-rows-3 grid-flow-col auto-cols-fr gap-px p-px">
        {buttons.map((b) => {
          if (!canShow(b)) return null;
          const id = `editor-button-${b.title}`;
          const selected = isSelected(b.section);
          return (
            <Button
              key={id}
              id={id}
              component="link"
              to={`/controller/${b.section}`}
              variant="none"
              svg={svgMap.get(b.type) || FileQuestion}
              color={iconColorMap.get(b.type)}
              iconSize="sm"
              gap="gap-1.5"
              padding="px-2 py-1.5"
              isSelected={selected}
              aria-label={b.ariaLabel ?? b.title}
              className={cn(
                "min-h-0 min-w-0 justify-start rounded-none transition-colors duration-150 ease-out",
                selected
                  ? "bg-cyan-500/12 ring-1 ring-inset ring-cyan-500/30 hover:bg-cyan-500/18"
                  : "hover:bg-black/22 active:bg-black/32"
              )}
            >
              <span className="truncate text-sm font-semibold text-white">
                {b.title}
              </span>
            </Button>
          );
        })}
      </div>
    </ErrorBoundary>
  );
};

export default EditorButtons;
