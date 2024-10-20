import ItemEditTools from "./ToolbarElements/ItemEditTools";
import Menu from "./ToolbarElements/Menu";
import QuickLinks from "./ToolbarElements/QuickLinks";
import Services from "./ToolbarElements/Services";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import cn from 'classnames'

type SectionProps = {
  children: React.ReactNode,
  last?: boolean,
}
const Section = ({ children, last } : SectionProps) => {
  return (
    <section className={
      cn(
        "p-2 flex gap-1 items-center", 
        !last && "border-r-2 border-slate-500",
        last && "ml-auto"
      )
    }>{children}</section>
  )
}

const Toolbar = () => {
    
  return (
    <div className="flex border-b-2 border-slate-500 h-20">
      <Section>
        <Menu/>
        <Undo/>
      </Section>
      <Section>
        <Services/>
      </Section>
      <Section>
        <SlideEditTools/>
      </Section>
      <Section>
        <ItemEditTools/>
      </Section>
      <Section>
        <QuickLinks/>
      </Section>
      <Section last>
        <UserSection/>
      </Section>
    </div>

  )
}

export default Toolbar;