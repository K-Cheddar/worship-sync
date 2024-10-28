import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import { MiddleSection } from "../../types";

type ButtonType = {
  type: string,
  title: string,
  section: MiddleSection
  action?: Function
}

const buttons: ButtonType[] = [
  {
    type: 'bible',
    title: 'Bible',
    section: 'bible-panel'
  },
  {
    type: 'song',
    title: 'Songs',
    section: 'songs-panel'
  },
  {
    type: 'participants',
    title: 'Participants',
    section: 'participants-panel'
  }
]

const EditorButtons = ({ setMiddleSection, middleSection }: { setMiddleSection: Function, middleSection: MiddleSection}) => {
  return (
    <div className="flex flex-col h-fit" >
        {buttons.map(({ title, type, section }) => {
          const id = `editor-button-${title}`;
          return (
            <LeftPanelButton
              key={id}
              title={title}
              isSelected={middleSection === section}
              handleClick={() => setMiddleSection(section)}
              type={type}
            />
          )
        })}

    </div>
  )

}

export default EditorButtons;