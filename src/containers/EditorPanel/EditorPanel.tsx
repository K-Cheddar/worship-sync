import Bible from "./EditorSections/Bible"
import Songs from "./EditorSections/Songs"
import AllItems from "./EditorSections/AllItems"
import Announcements from "./EditorSections/Announcements"
import Timers from "./EditorSections/Timers"
import Overlays from "./EditorSections/Overlays"

const EditorPanel = () => {
  return (
    <div>
      <Bible/>
      <Songs/>
      <AllItems/>
      <Announcements/>
      <Timers/>
      <Overlays/>
    </div>
  )
}

export default EditorPanel;
