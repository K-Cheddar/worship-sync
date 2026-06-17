import { useEffect, useRef, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/utils/cnHelper";
import Button from "../../components/Button/Button";
import { panelClassName, panelFormScrollPaddingClassName, panelHeaderPaddingClassName, panelScrollPaddingClassName, panelShellClassName, teamsCreatePanelFormClassName, teamsCreatePanelFormOpenMobileClassName, teamsCreatePanelListClosedClassName, teamsCreatePanelListOpenClassName, teamsCreatePanelOpenMobileClassName, teamsCreatePanelRowClassName, teamsPanelMaxHeightClassName } from "./teamsStyles";

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
  sectionTitle: ReactNode;
  /** Label for the collapsed create button (e.g. "Create position"). */
  createLabel: string;
  /** Optional helper text shown under the section title. */
  description?: ReactNode;
  /** Optional filters rendered above the list (e.g. search). Kept visible when the list scrolls. */
  listToolbar?: ReactNode;
  /** When true, the list scrolls inside the panel while the heading and toolbar stay fixed. */
  scrollableList?: boolean;
  /** The list of existing entities. */
  list: ReactNode;
  /** Optional secondary panel beside the list (e.g. member filters). */
  asideOpen?: boolean;
  /** Heading for the aside panel when open. */
  asideTitle?: string;
  /** Optional actions in the top-right of the aside panel (e.g. back/close). */
  asideHeaderActions?: ReactNode;
  /** Aside panel body (e.g. filter controls). */
  aside?: ReactNode;
  /** Optional id for the aside region (for aria-controls). */
  asideId?: string;
  /** Optional actions in the top-right of the open form panel (e.g. archive/delete menu). */
  formHeaderActions?: ReactNode;
  /** Save/cancel actions pinned below the form scroll area. */
  formFooter?: ReactNode;
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
  listToolbar,
  scrollableList = false,
  list,
  asideOpen = false,
  asideTitle = "",
  asideHeaderActions,
  aside,
  asideId,
  formHeaderActions,
  formFooter,
  children,
}: CreatePanelProps) => {
  const formPanelRef = useRef<HTMLDivElement>(null);
  const asidePanelRef = useRef<HTMLDivElement>(null);
  const formOpenOnMobile = open;
  const asideOpenOnMobile = asideOpen;
  const panelOpenOnMobile = open || asideOpen;
  const listHiddenOnMobile = formOpenOnMobile || asideOpenOnMobile;
  const listSharesSpace = open || asideOpen;

  useEffect(() => {
    if (!open) return;
    const scrollContainer = formPanelRef.current?.closest(".teams-section-scroll");
    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTop = 0;
      return;
    }
    formPanelRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  useEffect(() => {
    if (!asideOpen) return;
    const scrollContainer = asidePanelRef.current?.closest(".teams-section-scroll");
    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTop = 0;
    }
    asidePanelRef.current?.scrollIntoView({ block: "start" });
  }, [asideOpen]);

  return (
    <div className={cn("space-y-4", panelOpenOnMobile && teamsCreatePanelOpenMobileClassName)}>
      <div
        className={cn(
          teamsCreatePanelRowClassName,
          panelOpenOnMobile && teamsCreatePanelOpenMobileClassName,
        )}
      >
        <div
          className={cn(
            "w-full min-w-0 space-y-3",
            listSharesSpace
              ? teamsCreatePanelListOpenClassName
              : teamsCreatePanelListClosedClassName,
            listHiddenOnMobile && "max-lg:hidden",
          )}
        >
          <section
            className={cn(
              scrollableList ? panelShellClassName : panelClassName,
              scrollableList && cn("flex flex-col", teamsPanelMaxHeightClassName),
            )}
          >
            <div className={cn(scrollableList && cn("shrink-0", panelHeaderPaddingClassName))}>
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
            </div>
            {listToolbar ? (
              <div className={cn("mt-4 shrink-0", scrollableList && "px-4")}>{listToolbar}</div>
            ) : null}
            <div
              className={cn(
                "space-y-2",
                scrollableList
                  ? cn(
                    "scrollbar-variable mt-4 min-h-0 flex-1 overflow-y-auto",
                    panelScrollPaddingClassName,
                  )
                  : "mt-4",
              )}
            >
              {list}
            </div>
          </section>
        </div>
        <div
          ref={asidePanelRef}
          id={asideId}
          inert={!asideOpen}
          role="region"
          aria-label={asideTitle}
          className={cn(
            "min-w-0 overflow-hidden transition-all duration-300 ease-in-out motion-reduce:transition-none",
            asideOpen
              ? cn(
                "flex w-full flex-col",
                teamsCreatePanelFormClassName,
                teamsCreatePanelFormOpenMobileClassName,
                teamsPanelMaxHeightClassName,
              )
              : "pointer-events-none max-h-0 w-0 opacity-0",
          )}
        >
          <section
            className={cn(
              panelShellClassName,
              "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden",
            )}
          >
            <div
              className={cn(
                "sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-gray-700/50 bg-gray-900",
                panelHeaderPaddingClassName,
                "pb-3",
              )}
            >
              <h2 className="text-lg font-semibold">{asideTitle}</h2>
              {asideHeaderActions}
            </div>
            <div
              className={cn(
                "scrollbar-variable mt-4 min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto",
                panelFormScrollPaddingClassName,
                "pb-4",
              )}
            >
              {aside}
            </div>
          </section>
        </div>
        <div
          ref={formPanelRef}
          inert={!open}
          role="region"
          aria-label={title}
          className={cn(
            "min-w-0 overflow-hidden transition-all duration-300 ease-in-out motion-reduce:transition-none",
            open
              ? cn(
                "flex w-full flex-col",
                teamsCreatePanelFormClassName,
                teamsCreatePanelFormOpenMobileClassName,
                teamsPanelMaxHeightClassName,
              )
              : "pointer-events-none max-h-0 w-0 opacity-0",
          )}
        >
          <section
            className={cn(
              panelShellClassName,
              "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden",
            )}
          >
            <div
              className={cn(
                "flex shrink-0 items-start justify-between gap-3",
                panelHeaderPaddingClassName,
              )}
            >
              <h2 className="text-lg font-semibold">{title}</h2>
              {formHeaderActions}
            </div>
            <div
              className={cn(
                "scrollbar-variable mt-4 min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto",
                panelFormScrollPaddingClassName,
              )}
            >
              {children}
            </div>
            {formFooter}
          </section>
        </div>
      </div>
    </div>
  );
};

export default CreatePanel;
