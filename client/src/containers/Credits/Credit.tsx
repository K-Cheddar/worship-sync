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
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { deleteCredit, updateCredit } from "../../store/creditsSlice";
import { broadcastCreditsUpdate } from "../../store/store";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { putCreditDoc } from "../../utils/dbUtils";
import Input from "../../components/Input/Input";
import TextArea from "../../components/TextArea/TextArea";
import type { DBCredits } from "../../types";

const PERSIST_DEBOUNCE_MS = 500;

type CreditProps = CreditsInfo & {
  initialList: string[];
  selectCredit: () => void;
  selectedCreditId: string;
};

const Credit = ({
  heading,
  text,
  id,
  initialList,
  hidden,
  selectCredit,
  selectedCreditId,
}: CreditProps) => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) ?? {};

  const [isDeleting, setIsDeleting] = useState(false);
  const creditRef = useRef<HTMLLIElement | null>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistCredit = useCallback(
    async (payload: { heading: string; text: string; hidden?: boolean }) => {
      if (!db) return;
      const doc = await putCreditDoc(db, { id, ...payload });
      if (doc) broadcastCreditsUpdate([doc]);
    },
    [db, id]
  );

  const updateField = useCallback(
    (key: keyof Pick<CreditsInfo, "heading" | "text" | "hidden">, value: CreditsInfo[typeof key]) => {
      const next = { heading, text, hidden, [key]: value };
      dispatch(updateCredit({ id, ...next }));
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = setTimeout(
        () => persistCredit(next),
        PERSIST_DEBOUNCE_MS
      );
    },
    [dispatch, id, heading, text, hidden, persistCredit]
  );

  useEffect(
    () => () => {
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    },
    []
  );

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useGSAP(
    () => {
      if (!creditRef.current) return;

      if (isDeleting) {
        // delete animation
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
      // else if (!initialList.includes(id)) {
      //   // initial animation for new items
      //   gsap.timeline().fromTo(
      //     creditRef.current,
      //     {
      //       height: 0,
      //       opacity: 0,
      //     },
      //     {
      //       height: "auto",
      //       opacity: 1,
      //       duration: 0.5,
      //       ease: "power1.inOut",
      //     }
      //   );
      // }
    },
    { scope: creditRef, dependencies: [isDeleting] }
  );

  const deleteOverlayHandler = async () => {
    setIsDeleting(true);
    setTimeout(async () => {
      if (db) {
        try {
          const existingCredits: DBCredits = await db.get("credits");
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

  const toggleHidden = () => updateField("hidden", !hidden);

  // return <li className="h-[200px]">Lol Ok</li>;

  return (
    <li
      className={cn(
        "flex items-center rounded-lg w-full overflow-clip leading-3 bg-gray-800",
        hidden ? "opacity-50" : "",
        selectedCreditId === id && "bg-gray-950"
      )}
      ref={(element) => {
        setNodeRef(element);
        creditRef.current = element;
      }}
      style={style}
      id={`credit-editor-${id}`}
      onClick={selectCredit}
    >
      <Button
        variant="tertiary"
        className="text-sm ml-auto"
        padding="px-2 py-1"
        svg={Grip}
        {...listeners}
        {...attributes}
        tabIndex={-1}
      />
      <div className="flex flex-col flex-1 min-h-0 leading-4 text-center px-2 py-1.5 gap-1">
        <Input
          label="Heading"
          className="flex flex-col gap-1"
          hideLabel
          placeholder="Heading"
          value={heading}
          onChange={(val) => updateField("heading", val as string)}
          data-ignore-undo="true"
        />
        <TextArea
          label="Text"
          value={text}
          className="flex flex-col gap-1"
          hideLabel
          placeholder="Text"
          autoResize
          data-ignore-undo="true"
          onChange={(val) => updateField("text", val as string)}
        />
      </div>
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
    </li>
  );
};

export default Credit;
