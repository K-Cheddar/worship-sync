import { ListFilter, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import EntityListSearch from "./EntityListSearch";
import MultiCheckboxGroup from "./MultiCheckboxGroup";

export type EntityListFilterState = {
  teamIds: string[];
  includeArchived: boolean;
};

type EntityListFiltersProps = {
  entityLabel: string;
  query: string;
  onQueryChange: (value: string) => void;
  filters: EntityListFilterState;
  onFiltersChange: (value: EntityListFilterState) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  teamOptions?: { id: string; label: string }[];
};

export const EntityListFilterToolbar = ({
  entityLabel,
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  filtersOpen,
  onFiltersOpenChange,
}: EntityListFiltersProps) => {
  const activeCount = filters.teamIds.length + (filters.includeArchived ? 1 : 0);
  return (
    <div className="flex gap-2">
      <EntityListSearch
        className="min-w-0 flex-1"
        label={entityLabel}
        value={query}
        onChange={onQueryChange}
      />
      <div className="flex shrink-0">
        <Button
          type="button"
          variant="tertiary"
          svg={ListFilter}
          iconSize="sm"
          aria-expanded={filtersOpen}
          aria-label={activeCount ? `Filter ${entityLabel.toLowerCase()}, ${activeCount} selected` : `Filter ${entityLabel.toLowerCase()}`}
          onClick={() => onFiltersOpenChange(!filtersOpen)}
        >
          {activeCount ? `Filter (${activeCount})` : "Filter"}
        </Button>
        {activeCount ? (
          <Button
            type="button"
            variant="tertiary"
            svg={X}
            iconSize="sm"
            padding="px-1.5 py-1"
            aria-label={`Clear ${entityLabel.toLowerCase()} filters`}
            onClick={() => onFiltersChange({ teamIds: [], includeArchived: false })}
          />
        ) : null}
      </div>
    </div>
  );
};

export const EntityListFilterPanel = ({
  entityLabel,
  filters,
  onFiltersChange,
  teamOptions = [],
}: Pick<EntityListFiltersProps, "entityLabel" | "filters" | "onFiltersChange" | "teamOptions">) => (
  <div className="space-y-4">
    <Checkbox
      label={`Show archived ${entityLabel.toLowerCase()}`}
      checked={filters.includeArchived}
      onCheckedChange={(checked) =>
        onFiltersChange({ ...filters, includeArchived: Boolean(checked) })
      }
    />
    {teamOptions.length > 0 ? (
      <MultiCheckboxGroup
        label="Teams"
        options={teamOptions}
        value={filters.teamIds}
        onChange={(teamIds) => onFiltersChange({ ...filters, teamIds })}
      />
    ) : null}
  </div>
);

export const EntityListFilterFooter = ({
  filters,
  onClear,
  onClose,
}: {
  filters: EntityListFilterState;
  onClear: () => void;
  onClose: () => void;
}) => (
  <div className="shrink-0 border-t border-gray-700/50 bg-gray-950/45 px-4 py-3">
    <div className="flex gap-3">
      <Button
        type="button"
        variant="secondary"
        className="flex-1 justify-center"
        disabled={filters.teamIds.length === 0 && !filters.includeArchived}
        onClick={onClear}
      >
        Clear all
      </Button>
      <Button
        type="button"
        variant="cta"
        svg={X}
        iconSize="sm"
        className="flex-1 justify-center"
        onClick={onClose}
      >
        Close
      </Button>
    </div>
  </div>
);
