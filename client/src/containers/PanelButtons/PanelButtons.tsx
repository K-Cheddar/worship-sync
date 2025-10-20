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
    access: ["full"],
  },
  {
    type: "song",
    title: "Songs",
    section: "songs",
    access: ["full", "music"],
  },
  {
    type: "free",
    title: "Free Form Items",
    section: "free",
    access: ["full"],
  },
  {
    type: "timer",
    title: "Timers",
    section: "timers",
    access: ["full"],
  },
  {
    type: "overlays",
    title: "Overlays",
    section: "overlays",
    access: ["full"],
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

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-fit">
        {buttons
          .filter((button) => access && button.access?.includes(access))
          .map(({ title, type, section }) => {
            const id = `editor-button-${title}`;
            return (
              <LeftPanelButton
                key={id}
                title={title}
                isSelected={
                  location.pathname.replace("/controller/", "") === section
                } // Remove controller route from path
                to={section}
                type={type}
                id={id}
              />
            );
          })}
      </div>
    </ErrorBoundary>
  );
};

export default EditorButtons;
