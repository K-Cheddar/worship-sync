import { useState } from "react";
import cn from "classnames";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import Modal from "../components/Modal/Modal";
import { useToast } from "../context/toastContext";
import { updateBoardAliasTitle } from "./api";
import { BOARD_TITLE_MAX_LENGTH, BOARD_TITLE_WARNING_THRESHOLD } from "./boardUtils";
import { DBBoardAlias } from "../types";

type BoardRenameModalInnerProps = {
  alias: DBBoardAlias;
  isActing: boolean;
  onClose: () => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onRenamed: (alias: DBBoardAlias) => void;
};

const BoardRenameModalInner = ({
  alias,
  isActing,
  onClose,
  runAction,
  onRenamed,
}: BoardRenameModalInnerProps) => {
  const { showToast } = useToast();
  const [renameTitle, setRenameTitle] = useState(() =>
    alias.title.slice(0, BOARD_TITLE_MAX_LENGTH),
  );

  const handleClose = () => {
    if (isActing) return;
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title="Rename discussion board"
      size="sm"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold p-1">Title:</p>
          {renameTitle.length > BOARD_TITLE_WARNING_THRESHOLD && (
            <p
              className={cn(
                "text-sm",
                renameTitle.length >= BOARD_TITLE_MAX_LENGTH
                  ? "font-medium text-amber-300"
                  : "text-gray-400",
              )}
            >
              {renameTitle.length}/{BOARD_TITLE_MAX_LENGTH}
            </p>
          )}
        </div>
        <Input
          id="board-rename-title"
          label="Title"
          hideLabel
          value={renameTitle}
          onChange={(value) => setRenameTitle(String(value))}
          placeholder="Discussion board title"
          maxLength={BOARD_TITLE_MAX_LENGTH}
        />
        <p className="text-sm text-gray-300">
          The link stays the same. Only the board title changes.
        </p>
        <div className="flex gap-3">
          <Button
            className="flex-1 justify-center"
            variant="tertiary"
            onClick={onClose}
            disabled={isActing}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 justify-center"
            variant="secondary"
            onClick={() =>
              void runAction(async () => {
                const response = await updateBoardAliasTitle(
                  alias.aliasId,
                  renameTitle,
                );
                onRenamed(response.alias);
                showToast("Discussion board renamed.", "success");
              })
            }
            disabled={isActing || !renameTitle.trim()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};

type BoardRenameModalProps = {
  alias: DBBoardAlias | null;
  isActing: boolean;
  onClose: () => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onRenamed: (alias: DBBoardAlias) => void;
};

export const BoardRenameModal = ({
  alias,
  isActing,
  onClose,
  runAction,
  onRenamed,
}: BoardRenameModalProps) => {
  if (!alias) return null;

  return (
    <BoardRenameModalInner
      key={alias.aliasId}
      alias={alias}
      isActing={isActing}
      onClose={onClose}
      runAction={runAction}
      onRenamed={onRenamed}
    />
  );
};
