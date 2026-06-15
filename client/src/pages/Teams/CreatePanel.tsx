import type { ReactNode } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/utils/cnHelper";
import Button from "../../components/Button/Button";
import { panelClassName } from "./teamsStyles";

type CreatePanelProps = {
  /** Whether the create/edit form is revealed. */
  open: boolean;
  /** Called when the collapsed "Create" button is clicked. */
  onOpenCreate: () => void;
  /** Whether create/edit actions are available. */
  canEdit?: boolean;
  /** Heading shown above the form when open (e.g. "Create position" / "Edit position"). */
  title: string;
  /** Heading for the list section (e.g. "Positions"). */
  sectionTitle: string;
  /** Label for the collapsed create button (e.g. "Create position"). */
  createLabel: string;
  /** Optional helper text shown under the section title. */
  description?: ReactNode;
  /** The list of existing entities. */
  list: ReactNode;
  /** The form fields. */
  children: ReactNode;
};

/**
 * Gates a manager's create/edit form behind a button. The list sits in a
 * centered, limited-width column; the create/edit form panel sits to
 * the right of the list on large screens. The form panel animates its width on
 * entry/exit.
 */
const CreatePanel = ({
  open,
  onOpenCreate,
  canEdit = true,
  title,
  sectionTitle,
  createLabel,
  description,
  list,
  children,
}: CreatePanelProps) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-center">
        <div className="w-full min-w-0 space-y-3 lg:max-w-3xl">
          <section className={panelClassName}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{sectionTitle}</h2>
              {!open && canEdit ? (
                <Button variant="primary" svg={Plus} iconSize="sm" onClick={onOpenCreate}>
                  {createLabel}
                </Button>
              ) : null}
            </div>
            {description ? (
              <p className="mt-1 text-sm text-gray-400">{description}</p>
            ) : null}
            <div className="mt-4 space-y-2">{list}</div>
          </section>
        </div>
        <div
          inert={!open}
          role="region"
          aria-label={title}
          className={cn(
            "overflow-hidden transition-all duration-300 ease-in-out motion-reduce:transition-none",
            open
              ? "max-h-[3000px] opacity-100 lg:max-h-none lg:w-md"
              : "pointer-events-none max-h-0 opacity-0 lg:max-h-none lg:w-0 lg:opacity-0",
          )}
        >
          <section className={cn(panelClassName, "lg:w-md")}>
            <h2 className="text-lg font-semibold">{title}</h2>
            <div className="mt-4 space-y-3">{children}</div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default CreatePanel;
