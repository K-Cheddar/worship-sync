import cn from "classnames";
import { Copy, Eye } from "lucide-react";
import Button from "../components/Button/Button";

const BOARD_COPY_LINK_ICON_COLOR = "#22d3ee";

export type BoardShareLinkGroupProps = {
  heading: string;
  onCopy: () => void | Promise<void>;
  onView: () => void;
  disabled: boolean;
  className?: string;
};

export const BoardShareLinkGroup = ({
  heading,
  onCopy,
  onView,
  disabled,
  className,
}: BoardShareLinkGroupProps) => (
  <div
    className={cn(
      "w-fit max-w-full shrink-0 rounded-lg border border-gray-600 bg-gray-900/50 p-3",
      className,
    )}
  >
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
      {heading}
    </p>
    <div className="mt-2 flex flex-row flex-wrap gap-2">
      <Button
        type="button"
        variant="primary"
        svg={Copy}
        color={BOARD_COPY_LINK_ICON_COLOR}
        onClick={() => void onCopy()}
        disabled={disabled}
        className="w-fit shrink-0 justify-center px-3"
      >
        Copy
      </Button>
      <Button
        type="button"
        variant="secondary"
        svg={Eye}
        color={BOARD_COPY_LINK_ICON_COLOR}
        onClick={onView}
        disabled={disabled}
        className="w-fit shrink-0 justify-center px-3"
      >
        View
      </Button>
    </div>
  </div>
);
