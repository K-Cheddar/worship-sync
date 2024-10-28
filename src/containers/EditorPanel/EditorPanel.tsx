import Bible from "./EditorSections/Bible"
import Songs from "./EditorSections/Songs"
import AllItems from "./EditorSections/AllItems"
import Announcements from "./EditorSections/Announcements"
import Timers from "./EditorSections/Timers"

const EditorPanel = () => {
  return (
    <div>
      <Bible/>
      <Songs/>
      <AllItems/>
      <Announcements/>
      <Timers/>
    </div>
  )
}

export default EditorPanel;
