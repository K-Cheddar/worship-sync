// import ItemEditTools from "./ToolbarElements/ItemEditTools";
import { useLocation } from "react-router-dom";
import Menu from "./ToolbarElements/Menu";
import Services from "./ToolbarElements/Services";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import cn from "classnames";
import { useSelector } from "../../hooks";
import { forwardRef } from "react";

type SectionProps = {
  children: React.ReactNode;
  last?: boolean;
  hidden?: boolean;
};
const Section = ({ children, last, hidden }: SectionProps) => {
  return (
    <section
      className={cn(
        "px-2 py-1 flex gap-1 items-center",
        !last && "border-r-2 border-slate-500",
        last && "ml-auto",
        hidden && "hidden"
      )}
    >
      {children}
    </section>
  );
};

const Toolbar = forwardRef<HTMLDivElement, { className: string }>(
  ({ className }, ref) => {
    const location = useLocation();
    const { isEditMode } = useSelector((state) => state.undoable.present.item);
    return (
      <div ref={ref} className={className}>
        <Section>
          <Menu />
        </Section>
        <Section hidden={isEditMode}>
          <Undo />
        </Section>
        <Section hidden={isEditMode}>
          <Services />
        </Section>
        {location.pathname.includes("controller/item") && (
          <Section hidden={isEditMode}>
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
  }
);

export default Toolbar;
