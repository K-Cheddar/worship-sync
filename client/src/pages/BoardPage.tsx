import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/utils/cnHelper";
import { Pencil, Shuffle } from "lucide-react";
import { useParams } from "react-router-dom";
import Button from "../components/Button/Button";
import Modal from "../components/Modal/Modal";
import Input from "../components/Input/Input";
import TextArea from "../components/TextArea/TextArea";
import { createBoardPost } from "../boards/api";
import { useBoardData } from "../boards/useBoardData";
import { useBoardEventStream } from "../boards/useBoardEventStream";
import { BoardPostMessage } from "../boards/BoardPostMessage";
import type { DBBoardPost } from "../types";
import {
  BOARD_LOCAL_NAME_STORAGE_KEY,
  BOARD_POST_MAX_LENGTH,
  BOARD_POST_WARNING_THRESHOLD,
  formatBoardTimestamp,
  generateAnonymousDisplayNameAvoidingDuplicates,
  getBoardAuthorNameColorClass,
  getBoardPostsForAttendeeView,
  getOrCreateBoardParticipantId,
  isBoardAuthorInUse,
  isBoardPostOwnedByParticipant,
} from "../boards/boardUtils";
import { useStickToBottomScroll } from "../hooks/useStickToBottomScroll";

const boardDarkFieldClassName =
  "rounded-md border border-stone-600 bg-stone-900 text-stone-100 caret-amber-400 placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40";

const boardFieldLabelClassName = "text-stone-200";

const boardModalBackdropClassName =
  "bg-stone-950/75 backdrop-blur-[1px]";
const boardModalSurfaceClassName =
  "max-h-[90vh] rounded-xl border border-stone-700 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.14),transparent_48%),linear-gradient(135deg,rgba(41,37,36,0.98),rgba(12,10,9,0.96))] ring-1 ring-amber-500/20 max-md:max-h-[95vh]";
const boardModalHeaderClassName =
  "border-b border-stone-700/90 bg-stone-950/35 px-5 py-4";
const boardModalTitleClassName = "text-lg text-stone-50";
/** Shared sizing for display name fields (initial step + change-name modal). */
const boardDisplayNameInputClassName = cn(
  boardDarkFieldClassName,
  "min-h-[3.25rem] rounded-lg py-3 pl-4 pr-12 text-lg leading-snug",
);

const BoardPage = () => {
  const { aliasId = "" } = useParams();
  const participantId = useMemo(() => getOrCreateBoardParticipantId(), []);
  const {
    alias,
    churchLogoUrl,
    posts,
    hasLoadedOnce,
    error,
    connectionStatus,
    loadBoard,
    loadPosts,
    retryNow,
  } =
    useBoardData(aliasId, { viewerAuthorId: participantId });
  const [author, setAuthor] = useState("");
  const [nameLocked, setNameLocked] = useState(false);
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [displayNameError, setDisplayNameError] = useState("");
  const [postSubmitError, setPostSubmitError] = useState("");
  const [displayNameModalOpen, setDisplayNameModalOpen] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");

  useBoardEventStream(aliasId, (event) => {
    if (event.type === "connected") return;

    if (
      event.type === "post-created" ||
      event.type === "post-updated" ||
      event.type === "board-soft-reset"
    ) {
      void loadPosts();
      return;
    }

    if (event.type === "board-presentation-updated") {
      return;
    }

    void loadBoard();
  });

  useEffect(() => {
    const saved = localStorage.getItem(BOARD_LOCAL_NAME_STORAGE_KEY) || "";
    const trimmed = saved.trim();
    setAuthor(trimmed);
    setNameLocked(Boolean(trimmed));
  }, []);

  useEffect(() => {
    if (author.trim()) {
      localStorage.setItem(BOARD_LOCAL_NAME_STORAGE_KEY, author.trim());
    }
  }, [author]);

  useEffect(() => {
    if (nameLocked) return;
    if (!displayNameError) return;
    const trimmed = author.trim();
    if (!trimmed) {
      setDisplayNameError("");
      return;
    }
    if (!isBoardAuthorInUse(posts, { author: trimmed, authorId: participantId })) {
      setDisplayNameError("");
    }
  }, [author, displayNameError, nameLocked, participantId, posts]);

  useEffect(() => {
    if (!displayNameModalOpen) return;
    if (!displayNameError) return;
    const trimmed = displayNameDraft.trim();
    if (!trimmed) {
      setDisplayNameError("");
      return;
    }
    if (!isBoardAuthorInUse(posts, { author: trimmed, authorId: participantId })) {
      setDisplayNameError("");
    }
  }, [
    displayNameDraft,
    displayNameError,
    displayNameModalOpen,
    participantId,
    posts,
  ]);

  const handleSaveInitialDisplayName = () => {
    const trimmed = author.trim();
    if (!trimmed) return;
    if (isBoardAuthorInUse(posts, { author: trimmed, authorId: participantId })) {
      setDisplayNameError("That display name is already in use. Pick another name.");
      return;
    }
    setAuthor(trimmed);
    localStorage.setItem(BOARD_LOCAL_NAME_STORAGE_KEY, trimmed);
    setNameLocked(true);
    setDisplayNameError("");
  };

  const handlePickAnonymousNameInitial = () => {
    const result = generateAnonymousDisplayNameAvoidingDuplicates(
      posts,
      participantId,
    );
    if (!result.ok) {
      setDisplayNameError(result.error);
      return;
    }
    const { name } = result;
    setAuthor(name);
    localStorage.setItem(BOARD_LOCAL_NAME_STORAGE_KEY, name);
    setNameLocked(true);
    setDisplayNameError("");
  };

  const openDisplayNameModal = useCallback(() => {
    setDisplayNameDraft(author);
    setDisplayNameError("");
    setDisplayNameModalOpen(true);
  }, [author]);

  const closeDisplayNameModal = useCallback(() => {
    setDisplayNameModalOpen(false);
    setDisplayNameError("");
  }, []);

  const handleSaveDisplayNameFromModal = () => {
    const trimmed = displayNameDraft.trim();
    if (!trimmed) return;
    if (isBoardAuthorInUse(posts, { author: trimmed, authorId: participantId })) {
      setDisplayNameError("That display name is already in use. Pick another name.");
      return;
    }
    setAuthor(trimmed);
    localStorage.setItem(BOARD_LOCAL_NAME_STORAGE_KEY, trimmed);
    setDisplayNameModalOpen(false);
    setDisplayNameError("");
  };

  const handlePickAnonymousNameInModal = () => {
    const result = generateAnonymousDisplayNameAvoidingDuplicates(
      posts,
      participantId,
    );
    if (!result.ok) {
      setDisplayNameError(result.error);
      return;
    }
    setDisplayNameDraft(result.name);
    setDisplayNameError("");
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!aliasId) return;
    setIsSubmitting(true);
    setPostSubmitError("");
    try {
      await createBoardPost(aliasId, {
        author,
        authorId: participantId,
        text,
      });
      setText("");
    } catch (nextError) {
      setPostSubmitError(
        nextError instanceof Error ? nextError.message : "Could not send post.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const attendeePosts = useMemo(
    () => getBoardPostsForAttendeeView(posts, { authorId: participantId }),
    [participantId, posts],
  );

  const postsScrollTrigger = useMemo(
    () => attendeePosts.map((p) => `${p._id}:${p._rev ?? ""}`).join("|"),
    [attendeePosts],
  );
  const { scrollRef, endRef, onScroll } = useStickToBottomScroll({
    scrollTrigger: postsScrollTrigger,
    resetKey: aliasId,
  });

  const isCurrentUserPost = (postAuthor: string) => {
    if (!nameLocked) return false;
    const mine = author.trim();
    if (!mine) return false;
    return postAuthor.trim().toLowerCase() === mine.toLowerCase();
  };

  const isMyPost = (post: DBBoardPost) => {
    if (isBoardPostOwnedByParticipant(post, { authorId: participantId })) {
      return true;
    }
    return isCurrentUserPost(post.author);
  };

  const randomDisplayNameEndAdornment = (onPick: () => void) => (
    <Button
      type="button"
      variant="tertiary"
      className="rounded-md p-1.5 text-amber-400/90 hover:bg-stone-700/90 hover:text-amber-300 focus-visible:ring-2 focus-visible:ring-amber-500/40"
      padding="p-0"
      svg={Shuffle}
      iconSize="md"
      aria-label="Use random name"
      title="Use random name"
      onClick={onPick}
    />
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-stone-950 text-white">
      {displayNameModalOpen && (
        <Modal
          isOpen
          onClose={closeDisplayNameModal}
          title="Change display name"
          size="sm"
          contentPadding="p-6"
          backdropClassName={boardModalBackdropClassName}
          surfaceClassName={boardModalSurfaceClassName}
          headerClassName={boardModalHeaderClassName}
          titleClassName={boardModalTitleClassName}
        >
          <div className="space-y-4">
            <p className="text-base text-stone-300">
              What should we call you?
            </p>
            <Input
              label="Display name"
              value={displayNameDraft}
              onChange={(value) => setDisplayNameDraft(String(value))}
              placeholder="Your name"
              labelClassName={boardFieldLabelClassName}
              labelFontSize="text-base"
              inputTextSize="text-lg"
              inputClassName={boardDisplayNameInputClassName}
              endAdornment={randomDisplayNameEndAdornment(handlePickAnonymousNameInModal)}
            />
            {displayNameError && (
              <p className="text-sm font-medium text-red-300">{displayNameError}</p>
            )}
            <div className="flex flex-row gap-2">
              <Button
                type="button"
                variant="tertiary"
                className="min-w-0 flex-1 justify-center sm:min-w-36"
                onClick={closeDisplayNameModal}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-w-0 flex-1 justify-center sm:min-w-36"
                onClick={handleSaveDisplayNameFromModal}
                disabled={!displayNameDraft.trim()}
              >
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-4 pt-4 pb-0">
        <header className="shrink-0 rounded-xl border border-stone-700 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),transparent_45%),linear-gradient(135deg,rgba(41,37,36,0.98),rgba(12,10,9,0.95))] p-6 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            Discussion Board
          </p>
          <div className="mt-3 flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            {churchLogoUrl ? (
              <img
                src={churchLogoUrl}
                alt=""
                className="mt-0.5 size-10 shrink-0 rounded-md border border-stone-600/90 bg-stone-950 object-contain sm:mt-0 sm:size-12"
              />
            ) : null}
            <h1 className="min-w-0 flex-1 text-3xl font-semibold sm:text-4xl">
              {alias?.title || "Board"}
            </h1>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-300 sm:text-base">
            Share a question or comment for others to see.
          </p>
        </header>

        <section className="mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="mb-3 flex shrink-0 items-center justify-between">
            <h2 className="text-xl font-semibold">Visible posts</h2>
            <span className="text-sm text-stone-400">{attendeePosts.length} shown</span>
          </div>

          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5"
          >
            {!hasLoadedOnce && connectionStatus.status !== "failed" ? (
              <div className="rounded-xl border border-stone-700 bg-stone-900/80 p-6">
                <p className="text-base font-semibold">
                  {connectionStatus.status === "retrying"
                    ? "Connection failed. Retrying..."
                    : "Connecting to discussion board..."}
                </p>
                <p className="mt-2 text-sm text-stone-400">
                  {connectionStatus.status === "retrying"
                    ? "The page will keep trying automatically."
                    : "Loading the latest posts from the server."}
                </p>
              </div>
            ) : !hasLoadedOnce ? (
              <div className="rounded-xl border border-red-400/40 bg-red-950/40 p-6">
                <p className="text-base font-semibold">
                  {error || "Could not load discussion board."}
                </p>
                <p className="mt-2 text-sm text-red-100/80">
                  Check the server connection, then try again.
                </p>
                <Button className="mt-4 justify-center" onClick={retryNow}>
                  Try Again
                </Button>
              </div>
            ) : attendeePosts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-600 bg-stone-900/60 p-8 text-center">
                <p className="text-lg font-semibold">No posts yet.</p>
                <p className="mt-2 text-sm text-stone-400">
                  Be the first to add one.
                </p>
              </div>
            ) : (
              <div className="space-y-4 pb-2">
                {attendeePosts.map((post) => {
                  const isMine = isMyPost(post);
                  const isHiddenFromOthers =
                    post.hidden && isBoardPostOwnedByParticipant(post, {
                      authorId: participantId,
                    });
                  const showAsMine = isMine && !isHiddenFromOthers;
                  return (
                    <article
                      key={post._id}
                      aria-label={
                        isHiddenFromOthers
                          ? "Your post, hidden from others by a moderator"
                          : undefined
                      }
                      className={cn(
                        "rounded-xl border p-5 shadow-lg",
                        isHiddenFromOthers &&
                        "border-dashed border-stone-500/70 bg-stone-950/90 ring-1 ring-stone-600/40",
                        !isHiddenFromOthers &&
                        showAsMine &&
                        "border-amber-500/45 bg-amber-950/30 ring-1 ring-amber-500/25",
                        !isHiddenFromOthers &&
                        !showAsMine &&
                        "border-stone-700 bg-stone-900/85",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm text-stone-300">
                        <span
                          className={cn(
                            "font-semibold",
                            isHiddenFromOthers && "text-stone-400",
                            !isHiddenFromOthers &&
                            showAsMine &&
                            "text-amber-100",
                            !isHiddenFromOthers &&
                            !showAsMine &&
                            getBoardAuthorNameColorClass(post),
                          )}
                        >
                          {post.author}
                        </span>
                        {isMine && (
                          <span className="rounded-full bg-amber-500/25 px-2 py-0.5 text-xs font-semibold text-amber-200">
                            You
                          </span>
                        )}
                        {isHiddenFromOthers && (
                          <span className="rounded-full border border-stone-500/60 bg-stone-900/90 px-2 py-0.5 text-xs font-semibold text-stone-300">
                            Hidden from others
                          </span>
                        )}
                        <span className={showAsMine ? "text-stone-400" : undefined}>
                          {formatBoardTimestamp(post.timestamp)}
                        </span>
                      </div>
                      <BoardPostMessage
                        text={post.text}
                        isMine={showAsMine}
                      />
                    </article>
                  );
                })}
              </div>
            )}

            {hasLoadedOnce && connectionStatus.status === "retrying" && (
              <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Connection failed. Retrying to refresh posts.
              </div>
            )}

            {hasLoadedOnce && connectionStatus.status === "failed" && (
              <div className="mt-4 rounded-lg border border-red-400/40 bg-red-950/30 px-4 py-3 text-sm text-red-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{error || "Could not refresh discussion board."}</span>
                  <Button variant="tertiary" onClick={retryNow}>
                    Try Again
                  </Button>
                </div>
              </div>
            )}
            <div ref={endRef} className="h-px shrink-0" aria-hidden />
          </div>
        </section>

        <section className="mt-4 shrink-0 rounded-xl border border-stone-700 bg-stone-900/95 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {!nameLocked ? (
            <div className="space-y-3">
              <p>
                What should we call you?
              </p>
              <Input
                label="Display name"
                value={author}
                onChange={(value) => setAuthor(String(value))}
                placeholder="Your name"
                labelClassName={boardFieldLabelClassName}
                inputClassName={boardDisplayNameInputClassName}
                endAdornment={randomDisplayNameEndAdornment(handlePickAnonymousNameInitial)}
              />
              {displayNameError && (
                <p className="text-sm font-medium text-red-300">{displayNameError}</p>
              )}
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-center"
                onClick={handleSaveInitialDisplayName}
                disabled={!author.trim()}
              >
                Continue
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="flex items-center justify-between gap-3 rounded-md border border-stone-600 bg-stone-950/50 px-3 py-2">
                <p className="min-w-0 flex-1 text-sm text-stone-300">
                  Posting as{" "}
                  <span className="font-semibold text-white">{author}</span>
                </p>
                <Button
                  type="button"
                  variant="tertiary"
                  className="shrink-0 rounded-md border border-stone-600/80 bg-stone-900/60 p-2 text-stone-200 hover:bg-stone-800/80"
                  padding="p-0"
                  svg={Pencil}
                  iconSize="md"
                  aria-label="Edit display name"
                  title="Edit display name"
                  onClick={openDisplayNameModal}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-stone-200">Question:</p>
                {text.length > BOARD_POST_WARNING_THRESHOLD && (
                  <p
                    className={cn(
                      "text-sm",
                      text.length >= BOARD_POST_MAX_LENGTH
                        ? "font-medium text-amber-300"
                        : "text-stone-400",
                    )}
                  >
                    {text.length}/{BOARD_POST_MAX_LENGTH}
                  </p>
                )}
              </div>
              <TextArea
                value={text}
                onChange={(value) => setText(value)}
                rows={3}
                maxLength={BOARD_POST_MAX_LENGTH}
                placeholder="Type your question or comment here."
                hideLabel
                label="Question"
                labelClassName={boardFieldLabelClassName}
                textareaClassName={`${boardDarkFieldClassName} h-auto max-h-28`}
              />
              {postSubmitError && (
                <p className="text-sm font-medium text-red-300">{postSubmitError}</p>
              )}
              <Button
                type="submit"
                variant="cta"
                className="w-full justify-center"
                disabled={isSubmitting || !author.trim() || !text.trim()}
              >
                {isSubmitting ? "Sending..." : "Send"}
              </Button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
};

export default BoardPage;
