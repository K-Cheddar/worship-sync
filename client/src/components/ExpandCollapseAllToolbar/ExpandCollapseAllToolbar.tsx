import Button from "../Button/Button";

export type ExpandCollapseAllToolbarProps = {
  visible: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
};

const BUTTON_PAD = "px-3 py-1.5";

/**
 * Expand/collapse-all controls for a list section (integrations rules, etc.).
 */
const ExpandCollapseAllToolbar = ({
  visible,
  onExpandAll,
  onCollapseAll,
}: ExpandCollapseAllToolbarProps) =>
  visible ? (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        type="button"
        variant="tertiary"
        padding={BUTTON_PAD}
        onClick={onExpandAll}
      >
        Expand all
      </Button>
      <Button
        type="button"
        variant="tertiary"
        padding={BUTTON_PAD}
        onClick={onCollapseAll}
      >
        Collapse all
      </Button>
    </div>
  ) : null;

export default ExpandCollapseAllToolbar;
