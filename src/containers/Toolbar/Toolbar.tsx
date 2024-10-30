// import ItemEditTools from "./ToolbarElements/ItemEditTools";
import { useLocation } from "react-router-dom";
import Menu from "./ToolbarElements/Menu";
import Services from "./ToolbarElements/Services";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import cn from "classnames";

type SectionProps = {
  children: React.ReactNode;
  last?: boolean;
};
const Section = ({ children, last }: SectionProps) => {
  return (
    <section
      className={cn(
        "px-2 py-0 flex gap-1 items-center",
        !last && "border-r-2 border-slate-500",
        last && "ml-auto"
      )}
    >
      {children}
    </section>
  );
};

const Toolbar = ({ className }: { className: string }) => {
  const location = useLocation();
  return (
    <div className={className}>
      <Section>
        <Menu />
        <Undo />
      </Section>
      <Section>
        <Services />
      </Section>
      {location.pathname.includes("controller/item") && (
        <Section>
          <SlideEditTools />
        </Section>
      )}
      {/* <Section>
        <ItemEditTools/>
      </Section> */}
      <Section last>
        <UserSection />
      </Section>
    </div>
  );
};

export default Toolbar;
