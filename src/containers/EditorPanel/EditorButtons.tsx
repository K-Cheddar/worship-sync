import {  useState } from "react";
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";

type ButtonType = {
  type: string,
  title: string,
  action?: Function
}

const buttons: ButtonType[] = [
  {
    type: 'bible',
    title: 'Bible',
  },
  {
    type: 'song',
    title: 'Songs',
  },
  {
    type: 'announcement',
    title: 'Announcements',
  },
  {
    type: 'timer',
    title: 'Timers',
  },
  {
    type: 'all',
    title: 'All Items',
  },
  {
    type: 'overlay',
    title: 'Overlays',
  }
]

const EditorButtons = () => {
  const [selected, setSelected] = useState("");
  return (
    <div className="flex flex-col h-48" >
        {buttons.map(({ title, type }, index) => {
          const id = `editor-button-${title}`;
          return (
            <LeftPanelButton
              key={id}
              title={title}
              id={id}
              selectedItem={selected}
              handleClick={setSelected}
              type={type}
            />
          )
        })}

    </div>
  )

}

export default EditorButtons;