import { useMemo, type ReactNode } from "react";
import { Music, Plus, Search } from "lucide-react";
import { Button, ButtonGroup, ButtonGroupItem } from "../../components/Button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/Popover";
import { findSongMatchSuggestions } from "../../integrations/servicePlanning/findServicePlanningSongMatch";
import { cn } from "../../utils/cnHelper";
import type { ServicePlanSongReference } from "../../types/servicePlan";
import { SERVICE_PLAN_SONG_ICON_CLASS } from "./servicePlanChipStyles";
import { useServicePlanSongLibrary } from "./useServicePlanSongLibrary";

/** Enough to recognise the right song without turning the popover into a list. */
const MAX_SUGGESTIONS = 3;

type ServicePlanSongSuggestionPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The song title the plan printed, which found no confident match. */
  title: string;
  onSelectSong: (songRef: ServicePlanSongReference) => void;
  /** Escalate to the full library search. */
  onOpenLibrary: () => void;
  /** Open the library on Create song, seeded from the plan title. */
  onCreateSong?: () => void;
  /** The chip the popover hangs off. */
  anchor: ReactNode;
};

/**
 * The near-misses for an imported song that couldn't be linked on its own.
 *
 * This sits between the chip and the library modal on purpose. Most unmatched
 * imports are a spelling or a subtitle away from a song already in the library,
 * and confirming that shouldn't cost a full-screen search — but the answers are
 * only wanted while someone is resolving the song, so they stay behind a click
 * rather than adding three song names to every row of a dense plan.
 */
const ServicePlanSongSuggestionPopover = ({
  open,
  onOpenChange,
  title,
  onSelectSong,
  onOpenLibrary,
  onCreateSong,
  anchor,
}: ServicePlanSongSuggestionPopoverProps) => {
  const { songs } = useServicePlanSongLibrary();
  // Only ranked while the popover is open: this runs per unlinked song, and a
  // plan holds many rows.
  const suggestions = useMemo(
    () => (open ? findSongMatchSuggestions(title, songs, MAX_SUGGESTIONS) : []),
    [open, songs, title],
  );

  const planTitle = title.trim() || "this item";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(20rem,calc(100vw-2rem))] border border-gray-700 bg-gray-900 p-2 text-white shadow-xl"
      >
        <div className="flex flex-col gap-2 text-left">
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Link a song
            </p>
            <p className="truncate text-sm font-medium" title={planTitle}>
              {planTitle}
            </p>
          </div>

          {suggestions.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <p className="px-1 text-[11px] text-gray-400">
                {suggestions.length === 1 ? "Closest match" : "Closest matches"}
              </p>
              {suggestions.map(({ song }) => (
                <Button
                  key={song._id}
                  type="button"
                  variant="tertiary"
                  className="max-md:min-h-0 w-full justify-start gap-1.5 px-1.5 py-1 text-left"
                  onClick={() => {
                    onSelectSong({
                      kind: "library",
                      songId: song._id,
                      songName: song.name,
                    });
                    onOpenChange(false);
                  }}
                >
                  <Music
                    className={cn("size-3.5 shrink-0", SERVICE_PLAN_SONG_ICON_CLASS)}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate text-sm">{song.name}</span>
                </Button>
              ))}
            </div>
          ) : (
            <p className="px-1 text-sm text-gray-300">
              No close matches in your song library.
            </p>
          )}

          <ButtonGroup className="w-full border-gray-500" display="flex">
            <ButtonGroupItem
              type="button"
              variant="secondary"
              svg={Search}
              iconSize="sm"
              className="max-md:min-h-0 gap-1 px-1.5 py-1"
              onClick={() => {
                onOpenChange(false);
                onOpenLibrary();
              }}
            >
              Search library
            </ButtonGroupItem>
            {onCreateSong ? (
              <ButtonGroupItem
                type="button"
                variant="tertiary"
                svg={Plus}
                iconSize="sm"
                className="max-md:min-h-0 gap-1 px-1.5 py-1"
                onClick={() => {
                  onOpenChange(false);
                  onCreateSong();
                }}
              >
                Create song
              </ButtonGroupItem>
            ) : null}
          </ButtonGroup>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ServicePlanSongSuggestionPopover;
