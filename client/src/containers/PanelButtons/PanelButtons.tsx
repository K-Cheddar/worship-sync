import { useLocation } from "react-router-dom";
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";

type ButtonType = {
  type: string;
  title: string;
  section: string;
  action?: Function;
};

const buttons: ButtonType[] = [
  {
    type: "bible",
    title: "Bible",
    section: "bible",
  },
  {
    type: "song",
    title: "Songs",
    section: "songs",
  },
  {
    type: "free",
    title: "Free Form Items",
    section: "free",
  },
  {
    type: "timer",
    title: "Timers",
    section: "timers",
  },
  {
    type: "overlays",
    title: "Overlays",
    section: "overlays",
  },
  {
    type: "create",
    title: "Create New Item",
    section: "create",
  },
];

const EditorButtons = () => {
  const location = useLocation();

  return (
    <div className="flex flex-col h-fit">
      {buttons.map(({ title, type, section }) => {
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
  );
};

export default EditorButtons;
