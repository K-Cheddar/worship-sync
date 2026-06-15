import Spinner from "../../../components/Spinner/Spinner";
import { formatChurchStatusLabel } from "../accountUtils";
import { useAccountPage } from "../AccountPageContext";
import type { AccountSection } from "../accountConstants";

type AccountSectionHeaderProps = {
  section: AccountSection;
};

const AccountSectionHeader = ({ section }: AccountSectionHeaderProps) => {
  const { isRefreshing, churchStatusRaw } = useAccountPage();

  return (
    <div className="flex flex-col gap-3 border-b border-gray-700/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-2xl font-semibold">{section.label}</h2>
        <p className="mt-1 max-w-xl text-sm text-gray-300">
          {section.description}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
        {isRefreshing ? (
          <div
            className="flex shrink-0 items-center gap-2 text-xs font-medium text-gray-200"
            role="status"
            aria-live="polite"
          >
            <Spinner
              width="16px"
              borderWidth="2px"
              className="shrink-0 border-cyan-400/90 border-b-transparent"
            />
            <span>Refreshing…</span>
          </div>
        ) : null}
        <span className="rounded-full border border-gray-600 bg-gray-950/45 px-3 py-1 text-xs font-medium text-gray-200">
          Status: {formatChurchStatusLabel(churchStatusRaw)}
        </span>
      </div>
    </div>
  );
};

export default AccountSectionHeader;
