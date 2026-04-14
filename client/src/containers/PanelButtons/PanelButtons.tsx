import { useLocation } from "react-router-dom";
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { AccessType } from "../../context/globalInfo";

type ButtonType = {
  type: string;
  title: string;
  section: string;
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
    type: "free",
    title: "Custom",
    section: "free",
    access: ["full", "view"],
  },
  {
    type: "timer",
    title: "Timers",
    section: "timers",
    access: ["full", "view"],
  },
  {
    type: "overlays",
    title: "Overlays",
    section: "overlays",
    access: ["full", "view"],
  },
  {
    type: "create",
    title: "Create New Item",
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
      <div className="flex flex-col h-fit">
        {buttons.map((b) => {
          if (!canShow(b)) return null;
          const id = `editor-button-${b.title}`;
          return (
            <LeftPanelButton
              key={id}
              title={b.title}
              isSelected={isSelected(b.section)}
              to={b.section}
              type={b.type}
              id={id}
            />
          );
        })}
      </div>
    </ErrorBoundary>
  );
};

export default EditorButtons;
