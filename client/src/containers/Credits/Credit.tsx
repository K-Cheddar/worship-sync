import Button from "../../components/Button/Button";
import { Trash2 } from "lucide-react";
import { Grip } from "lucide-react";
import { Eye } from "lucide-react";
import { EyeOff } from "lucide-react";
import { useDispatch } from "../../hooks";
import { cn } from "../../utils/cnHelper";
import gsap from "gsap";

import { CreditsInfo } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  memo,
} from "react";
import { useGSAP } from "@gsap/react";
import { deleteCredit, updateCredit } from "../../store/creditsSlice";
import { broadcastCreditsUpdate } from "../../store/store";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { putCreditDoc } from "../../utils/dbUtils";
import Input from "../../components/Input/Input";
import { getCreditsDocId, type DBCredits } from "../../types";
import CreditHistoryTextArea from "./CreditHistoryTextArea";
import {
  creditRowSelectedClass,
  creditRowUnselectedClass,
} from "../Overlays/overlayRowStyles";

const PERSIST_DEBOUNCE_MS = 500;
/** Batch Redux updates while typing so the list and undo stack do not churn every keystroke. */
const REDUX_DEBOUNCE_MS = 200;

type CreditProps = CreditsInfo & {
  /** Active service outline id for scoped Pouch docs. */
  outlineId: string | undefined;
  initialList: string[];
  onSelectCredit: (id: string) => void;
  selectedCreditId: string;
  /** History lines from saved credits history, used for suggestions. */
  historyLines: string[];
  /** Remove a line from history everywhere (all headings). */
  onRemoveHistoryLine?: (line: string) => void;
  readOnly?: boolean;
};

const Credit = ({
  heading,
  text,
  id,
  outlineId,
  initialList: _initialList,
  hidden,
  onSelectCredit,
  selectedCreditId,
  historyLines,
  onRemoveHistoryLine,
  readOnly = false,
}: CreditProps) => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) ?? {};

  const [isDeleting, setIsDeleting] = useState(false);
  const [draftHeading, setDraftHeading] = useState(heading);
  const [draftText, setDraftText] = useState(text);
  const creditRef = useRef<HTMLLIElement | null>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftHeadingRef = useRef(heading);
  const draftTextRef = useRef(text);
  const hiddenRef = useRef(hidden);

  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  useEffect(() => {
    setDraftHeading(heading);
    setDraftText(text);
    draftHeadingRef.current = heading;
    draftTextRef.current = text;
  }, [id, heading, text]);

  const persistCredit = useCallback(
    async (payload: { heading: string; text: string; hidden?: boolean }) => {
      if (!db || !outlineId) return;
      const doc = await putCreditDoc(db, outlineId, { id, ...payload });
      if (doc) broadcastCreditsUpdate([doc]);
    },
    [db, id, outlineId]
  );

  const flushDraftToRedux = useCallback(() => {
    const h = draftHeadingRef.current;
    const t = draftTextRef.current;
    const hid = hiddenRef.current;
    dispatch(updateCredit({ id, heading: h, text: t, hidden: hid }));
  }, [dispatch, id]);

  const scheduleDebouncedRedux = useCallback(() => {
    if (reduxDebounceRef.current) clearTimeout(reduxDebounceRef.current);
    reduxDebounceRef.current = setTimeout(() => {
      reduxDebounceRef.current = null;
      const h = draftHeadingRef.current;
      const t = draftTextRef.current;
      const hid = hiddenRef.current;
      dispatch(updateCredit({ id, heading: h, text: t, hidden: hid }));
    }, REDUX_DEBOUNCE_MS);
  }, [dispatch, id]);

  /** Persist to Pouch ~500ms after the last keystroke (independent of Redux debounce). */
  const bumpPersistTimeout = useCallback(() => {
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(() => {
      persistCredit({
        heading: draftHeadingRef.current,
        text: draftTextRef.current,
        hidden: hiddenRef.current,
      });
    }, PERSIST_DEBOUNCE_MS);
  }, [persistCredit]);

  useEffect(
    () => () => {
      if (reduxDebounceRef.current) {
        clearTimeout(reduxDebounceRef.current);
        reduxDebounceRef.current = null;
        flushDraftToRedux();
      }
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    },
    [flushDraftToRedux]
  );

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id,
      disabled: readOnly,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useGSAP(
    () => {
      if (!creditRef.current) return;

      if (isDeleting) {
        gsap.timeline().fromTo(
          creditRef.current,
          {
            height: creditRef.current.offsetHeight,
            opacity: 1,
          },
          {
            height: 0,
            opacity: 0,
            duration: 0.5,
            ease: "power1.inOut",
          }
        );
      }
    },
    { scope: creditRef, dependencies: [isDeleting] }
  );

  const deleteOverlayHandler = async () => {
    if (reduxDebounceRef.current) {
      clearTimeout(reduxDebounceRef.current);
      reduxDebounceRef.current = null;
      flushDraftToRedux();
    }
    setIsDeleting(true);
    setTimeout(async () => {
      if (db && outlineId) {
        try {
          const existingCredits: DBCredits = await db.get(
            getCreditsDocId(outlineId),
          );
          const creditIds = existingCredits.creditIds.filter((x) => x !== id);
          existingCredits.creditIds = creditIds;
          existingCredits.updatedAt = new Date().toISOString();
          await db.put(existingCredits);
          broadcastCreditsUpdate([existingCredits]);
        } catch (e) {
          console.error("Failed to remove credit from list", e);
        }
      }
      dispatch(deleteCredit(id));
      setIsDeleting(false);
    }, 500);
  };

  const toggleHidden = () => {
    if (reduxDebounceRef.current) {
      clearTimeout(reduxDebounceRef.current);
      reduxDebounceRef.current = null;
    }
    const nextHidden = !hidden;
    const h = draftHeadingRef.current;
    const t = draftTextRef.current;
    dispatch(updateCredit({ id, heading: h, text: t, hidden: nextHidden }));
    hiddenRef.current = nextHidden;
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(
      () => persistCredit({ heading: h, text: t, hidden: nextHidden }),
      PERSIST_DEBOUNCE_MS
    );
  };

  const handleRowClick = useCallback(() => {
    onSelectCredit(id);
  }, [id, onSelectCredit]);

  const onHeadingChange = useCallback(
    (val: string) => {
      const v = val as string;
      setDraftHeading(v);
      draftHeadingRef.current = v;
      scheduleDebouncedRedux();
      bumpPersistTimeout();
    },
    [scheduleDebouncedRedux, bumpPersistTimeout]
  );

  const onTextChange = useCallback(
    (val: string) => {
      setDraftText(val);
      draftTextRef.current = val;
      scheduleDebouncedRedux();
      bumpPersistTimeout();
    },
    [scheduleDebouncedRedux, bumpPersistTimeout]
  );

  return (
    <li
      className={cn(
        "flex items-center w-full overflow-clip leading-3 transition-colors",
        hidden ? "opacity-50" : "",
        selectedCreditId === id ? creditRowSelectedClass : creditRowUnselectedClass
      )}
      ref={(element) => {
        setNodeRef(element);
        creditRef.current = element;
      }}
      style={style}
      id={`credit-editor-${id}`}
      onClick={handleRowClick}
    >
      {!readOnly && (
        <Button
          variant="tertiary"
          className="text-sm ml-auto"
          padding="px-2 py-1"
          svg={Grip}
          {...listeners}
          {...attributes}
          tabIndex={-1}
        />
      )}
      <div className="flex flex-col flex-1 min-h-0 leading-4 text-center px-2 py-1.5 gap-1">
        <Input
          label="Heading"
          className="flex flex-col gap-1"
          hideLabel
          placeholder="Heading"
          value={draftHeading}
          onChange={onHeadingChange}
          data-ignore-undo="true"
          disabled={readOnly}
        />
        <CreditHistoryTextArea
          value={draftText}
          onChange={onTextChange}
          historyLines={historyLines}
          onRemoveHistoryLine={onRemoveHistoryLine}
          disabled={readOnly}
        />
      </div>
      {!readOnly && (
        <>
          <Button
            variant="tertiary"
            className="text-sm"
            padding="px-2 py-1"
            svg={hidden ? EyeOff : Eye}
            tabIndex={-1}
            onClick={toggleHidden}
          />
          <Button
            variant="tertiary"
            className="text-sm"
            padding="px-2 py-1"
            svg={Trash2}
            tabIndex={-1}
            onClick={deleteOverlayHandler}
          />
        </>
      )}
    </li>
  );
};

export default memo(Credit);
