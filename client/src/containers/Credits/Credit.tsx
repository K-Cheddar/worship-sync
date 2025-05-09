import Button from "../../components/Button/Button";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { ReactComponent as DragHandleSVG } from "../../assets/icons/drag-handle.svg";
import { ReactComponent as EyeSVG } from "../../assets/icons/visible.svg";
import { ReactComponent as EyeOffSVG } from "../../assets/icons/not-visible.svg";
import { useDispatch } from "../../hooks";
import "./Credits.scss";
import gsap from "gsap";

import { CreditsInfo } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { deleteCredit, updateCredit } from "../../store/creditsSlice";
import Input from "../../components/Input/Input";
import TextArea from "../../components/TextArea/TextArea";

type CreditProps = CreditsInfo & {
  initialList: string[];
};

const Credit = ({ heading, text, id, initialList, hidden }: CreditProps) => {
  const dispatch = useDispatch();

  const [isDeleting, setIsDeleting] = useState(false);
  const creditRef = useRef<HTMLLIElement | null>(null);

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

  const deleteOverlayHandler = () => {
    setIsDeleting(true);
    setTimeout(() => {
      dispatch(deleteCredit(id));
      setIsDeleting(false);
    }, 500);
  };

  const toggleHidden = () => {
    dispatch(updateCredit({ id, heading, text, hidden: !hidden }));
  };

  return (
    <li
      className={`flex items-center rounded-lg w-full overflow-clip leading-3 bg-gray-800 ${
        hidden ? "opacity-50" : ""
      }`}
      ref={(element) => {
        setNodeRef(element);
        creditRef.current = element;
      }}
      style={style}
      id={`credit-editor-${id}`}
      onClick={() => {
        document
          .getElementById(`credit-${id}`)
          ?.scrollIntoView({ behavior: "smooth" });
      }}
    >
      <Button
        variant="tertiary"
        className="text-sm ml-auto h-full"
        padding="px-2 py-1"
        svg={DragHandleSVG}
        {...listeners}
        {...attributes}
        tabIndex={-1}
      />
      <div className="flex flex-col flex-1 h-full leading-4 text-center px-2 py-1.5 gap-1">
        <Input
          label="Heading"
          className="flex flex-col gap-1"
          hideLabel
          placeholder="Heading"
          value={heading}
          onChange={(val) => {
            dispatch(
              updateCredit({ id, heading: val as string, text, hidden })
            );
          }}
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
          onChange={(val) => {
            dispatch(
              updateCredit({ id, heading, text: val as string, hidden })
            );
          }}
        />
      </div>
      <Button
        variant="tertiary"
        className="text-sm ml-auto h-full"
        padding="px-2 py-1"
        svg={hidden ? EyeOffSVG : EyeSVG}
        tabIndex={-1}
        onClick={toggleHidden}
      />
      <Button
        variant="tertiary"
        className="text-sm ml-auto h-full"
        padding="px-2 py-1"
        svg={DeleteSVG}
        tabIndex={-1}
        onClick={deleteOverlayHandler}
      />
    </li>
  );
};

export default Credit;
