import cn from "classnames";
import { Pencil, Trash2 } from "lucide-react";
import Button from "../components/Button/Button";
import { BoardCreateDiscussionForm } from "./BoardCreateDiscussionForm";
import { BOARD_PANEL_BODY, BOARD_PANEL_CARD, BOARD_PANEL_HEADER } from "./boardPanelTheme";
import type { DBBoardAlias } from "../types";

export type ManageBoardsPanelBodyProps = {
  database: string | undefined;
  isActing: boolean;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onCreated: (aliasId: string) => void;
  aliases: DBBoardAlias[];
  selectedAliasId: string;
  onSelectAlias: (aliasId: string) => void;
  onRenameAlias: (aliasId: string) => void;
  onDeleteAlias: (alias: DBBoardAlias) => void;
};

export const ManageBoardsPanelBody = ({
  database,
  isActing,
  runAction,
  onCreated,
  aliases,
  selectedAliasId,
  onSelectAlias,
  onRenameAlias,
  onDeleteAlias,
}: ManageBoardsPanelBodyProps) => (
  <>
    <BoardCreateDiscussionForm
      database={database}
      isActing={isActing}
      runAction={runAction}
      onCreated={onCreated}
    />
    <div className={cn("mt-4", BOARD_PANEL_CARD)}>
      <div className={BOARD_PANEL_HEADER}>
        <h2 className="text-base font-semibold">Discussion Boards</h2>
      </div>
      <div
        className={cn(
          "scrollbar-variable max-h-[55dvh] overflow-x-hidden overflow-y-auto overscroll-contain xl:max-h-[40dvh]",
          BOARD_PANEL_BODY,
        )}
      >
        {aliases.length === 0 && (
          <p className="px-4 py-4 text-sm text-gray-300">
            No discussion boards yet.
          </p>
        )}
        {aliases.map((alias) => (
          <div
            key={alias.aliasId}
            className={cn(
              "flex cursor-pointer items-start gap-2 border-b border-gray-600 border-l-4 px-4 py-3 transition-colors last:border-b-0",
              selectedAliasId === alias.aliasId
                ? "border-l-cyan-500 bg-gray-900/55 hover:bg-gray-900/70"
                : "border-l-transparent bg-gray-700/35 hover:bg-gray-700/50",
            )}
          >
            <button
              type="button"
              aria-current={selectedAliasId === alias.aliasId ? "true" : undefined}
              className="min-w-0 flex-1 cursor-pointer overflow-hidden text-left transition-colors hover:text-white"
              title={`${alias.title} (${alias.aliasId})`}
              onClick={() => onSelectAlias(alias.aliasId)}
            >
              <span className="block truncate font-semibold leading-snug">
                {alias.title}
              </span>
              <span className="block truncate font-mono text-xs text-gray-400">
                {alias.aliasId}
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="tertiary"
                svg={Pencil}
                padding="p-2"
                className="min-h-0!"
                aria-label={`Rename ${alias.title}`}
                onClick={() => onRenameAlias(alias.aliasId)}
                disabled={isActing}
              />
              <Button
                variant="destructive"
                svg={Trash2}
                padding="p-2"
                className="min-h-0!"
                aria-label={`Delete ${alias.title}`}
                onClick={() => onDeleteAlias(alias)}
                disabled={isActing}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  </>
);
