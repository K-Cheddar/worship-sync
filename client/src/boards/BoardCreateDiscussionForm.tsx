import { useMemo, useState } from "react";
import cn from "classnames";
import { Plus } from "lucide-react";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import { useToast } from "../context/toastContext";
import { createBoardAlias } from "./api";
import {
  BOARD_TITLE_MAX_LENGTH,
  BOARD_TITLE_WARNING_THRESHOLD,
  normalizeAliasId,
} from "./boardUtils";
import {
  BOARD_PANEL_BODY,
  BOARD_PANEL_CARD,
  BOARD_PANEL_HEADER,
} from "./boardPanelTheme";

type BoardCreateDiscussionFormProps = {
  database: string | undefined;
  isActing: boolean;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onCreated: (aliasId: string) => void;
};

export const BoardCreateDiscussionForm = ({
  database,
  isActing,
  runAction,
  onCreated,
}: BoardCreateDiscussionFormProps) => {
  const { showToast } = useToast();
  const [createTitle, setCreateTitle] = useState("");
  const derivedCreateAlias = useMemo(
    () => normalizeAliasId(createTitle),
    [createTitle],
  );

  const handleCreate = () => {
    if (!database) return;
    void runAction(async () => {
      const response = await createBoardAlias({
        aliasId: derivedCreateAlias,
        title: createTitle,
        database,
      });
      setCreateTitle("");
      onCreated(response.alias.aliasId);
      showToast("Discussion board created.", "success");
    });
  };

  return (
    <div className={BOARD_PANEL_CARD}>
      <div className={BOARD_PANEL_HEADER}>
        <h2 className="text-base font-semibold">Create Discussion Board</h2>
      </div>
      <div className={cn("space-y-3 p-4", BOARD_PANEL_BODY)}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold p-1">Title:</p>
          {createTitle.length > BOARD_TITLE_WARNING_THRESHOLD && (
            <p
              className={cn(
                "text-sm",
                createTitle.length >= BOARD_TITLE_MAX_LENGTH
                  ? "font-medium text-amber-300"
                  : "text-gray-400",
              )}
            >
              {createTitle.length}/{BOARD_TITLE_MAX_LENGTH}
            </p>
          )}
        </div>
        <Input
          id="board-create-title"
          label="Title"
          hideLabel
          value={createTitle}
          onChange={(value) => setCreateTitle(String(value))}
          placeholder="Sabbath School Discussion"
          maxLength={BOARD_TITLE_MAX_LENGTH}
        />
        <div className="rounded-md border border-gray-600 bg-gray-800/80 px-3 py-2">
          <p className="text-xs font-medium text-gray-400">Link name</p>
          <p
            className={cn(
              "mt-1 break-all text-sm",
              derivedCreateAlias ? "font-mono font-semibold text-white" : "text-gray-400",
            )}
          >
            {derivedCreateAlias || "Enter a title to see the link name"}
          </p>
        </div>
        <Button
          variant="cta"
          className="w-full justify-center"
          svg={Plus}
          onClick={handleCreate}
          disabled={
            isActing || !database || !createTitle.trim() || !derivedCreateAlias
          }
        >
          Create Discussion Board
        </Button>
      </div>
    </div>
  );
};
