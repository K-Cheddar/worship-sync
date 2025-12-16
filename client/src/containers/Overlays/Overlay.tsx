import Button from "../../components/Button/Button";
import { Airplay } from "lucide-react";
import { Trash2 } from "lucide-react";
import { useDispatch } from "../../hooks";
import { addToInitialList } from "../../store/overlaysSlice";
import gsap from "gsap";
import {
  updateImageOverlayInfo,
  updateParticipantOverlayInfo,
  updateQrCodeOverlayInfo,
  updateStbOverlayInfo,
  updateStream,
} from "../../store/presentationSlice";
import { OverlayInfo } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";

type OverlayProps = {
  overlay: OverlayInfo;
  selectedId: string;
  isStreamTransmitting: boolean;
  initialList: string[];
  selectAndLoadOverlay: (overlayId: string) => void;
  handleDeleteOverlay: (overlayId: string) => void;
};

const Overlay = ({
  overlay,
  selectedId,
  isStreamTransmitting,
  initialList,
  selectAndLoadOverlay,
  handleDeleteOverlay,
}: OverlayProps) => {
  const dispatch = useDispatch();

  const previousOverlay = useRef<OverlayInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const overlayRef = useRef<HTMLLIElement | null>(null);

  // const [debouncedOverlay, setDebouncedOverlay] = useState(overlay);

  const isSelected = selectedId === overlay.id;
  const hasData =
    (overlay.type === "participant" &&
      (overlay.name || overlay.title || overlay.event)) ||
    (overlay.type === "stick-to-bottom" &&
      (overlay.heading || overlay.subHeading)) ||
    (overlay.type === "qr-code" && (overlay.description || overlay.url)) ||
    (overlay.type === "image" && (overlay.imageUrl || overlay.name));

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: overlay.id,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // useDebouncedEffect(
  //   () => {
  //     setDebouncedOverlay((prev) => {
  //       previousOverlay.current = prev;
  //       return overlay;
  //     });
  //   },
  //   [overlay],
  //   500,
  //   true
  // );

  useGSAP(
    () => {
      if (!overlayRef.current) return;

      // highlight item if name or background changes
      if (
        previousOverlay.current &&
        (previousOverlay.current.name !== overlay.name ||
          previousOverlay.current.title !== overlay.title ||
          previousOverlay.current.event !== overlay.event ||
          previousOverlay.current.heading !== overlay.heading ||
          previousOverlay.current.subHeading !== overlay.subHeading ||
          previousOverlay.current.url !== overlay.url ||
          previousOverlay.current.description !== overlay.description ||
          previousOverlay.current.type !== overlay.type ||
          previousOverlay.current.duration !== overlay.duration ||
          previousOverlay.current.imageUrl !== overlay.imageUrl)
      ) {
        // TODO - See if this can be done nicely with the update changes.
        // Right now it is too loud
        // gsap
        //   .timeline()
        //   .fromTo(
        //     overlayRef.current,
        //     { backgroundColor: overlayRef.current.style.backgroundColor },
        //     {
        //       backgroundColor: "rgba(255, 255, 255, 0.75)",
        //       duration: 0.5,
        //       ease: "power1.inOut",
        //     }
        //   )
        //   .to(overlayRef.current, {
        //     backgroundColor: overlayRef.current.style.backgroundColor,
        //     duration: 0.5,
        //     ease: "power1.inOut",
        //   });
      } else if (isDeleting) {
        // delete animation
        gsap.timeline().fromTo(
          overlayRef.current,
          {
            height: overlayRef.current.offsetHeight,
            opacity: 1,
          },
          {
            height: 0,
            opacity: 0,
            duration: 0.5,
            ease: "power1.inOut",
          }
        );
      } else if (!initialList.includes(overlay.id)) {
        // initial animation for new items
        gsap
          .timeline()
          .fromTo(
            overlayRef.current,
            {
              height: 0,
              opacity: 0,
            },
            {
              height: "auto",
              opacity: 1,
              duration: 0.5,
              ease: "power1.inOut",
            }
          )
          .then(() => {
            dispatch(addToInitialList([overlay.id]));
          });
      }
    },
    { scope: overlayRef, dependencies: [overlay, isDeleting] }
  );

  const deleteOverlayHandler = () => {
    setIsDeleting(true);
    setTimeout(() => {
      handleDeleteOverlay(overlay.id);
      setIsDeleting(false);
    }, 500);
  };

  return (
    <li
      className={`flex items-center rounded-lg w-full overflow-clip leading-3 ${
        isSelected ? "bg-gray-950" : "bg-gray-800"
      }`}
      ref={(element) => {
        setNodeRef(element);
        overlayRef.current = element;
      }}
      style={style}
      {...attributes}
      {...listeners}
      id={`overlay-${overlay.id}`}
    >
      <Button
        variant="tertiary"
        wrap
        className="flex-col flex-1 h-full leading-4 text-center"
        padding="px-2 py-1.5"
        gap="gap-1"
        onClick={() => selectAndLoadOverlay(overlay.id)}
      >
        {overlay.type === "participant" && (
          <>
            {overlay.name && (
              <span className="text-base flex items-center h-full">
                {overlay.name}
              </span>
            )}
            {overlay.title && (
              <span className="flex text-sm items-center h-full italic">
                {overlay.title}
              </span>
            )}
            {overlay.event && (
              <span className="flex text-sm items-center h-full">
                {overlay.event}
              </span>
            )}
          </>
        )}
        {overlay.type === "stick-to-bottom" && (
          <>
            {overlay.heading && (
              <span className="flex text-sm items-center h-full">
                {overlay.heading}
              </span>
            )}
            {overlay.subHeading && (
              <span className="flex text-sm items-center h-full">
                {overlay.subHeading}
              </span>
            )}
          </>
        )}

        {overlay.type === "qr-code" && (
          <>
            {overlay.description && (
              <span className="flex text-sm items-center h-full">
                {overlay.description.split("\n")[0]}
              </span>
            )}
          </>
        )}

        {overlay.type === "image" && (
          <>
            {overlay.name && (
              <span className="flex text-sm items-center h-full">
                {overlay.name}
              </span>
            )}
          </>
        )}

        {!hasData && (
          <span className="text-sm leading-7">
            Click to add overlay details
          </span>
        )}
      </Button>
      <Button
        variant="tertiary"
        className="text-sm ml-auto h-full"
        padding="px-2 py-1"
        svg={Trash2}
        onClick={deleteOverlayHandler}
      />
      {hasData && (
        <Button
          color={isStreamTransmitting ? "#22c55e" : "gray"}
          variant="tertiary"
          className="text-sm ml-auto h-full"
          padding="px-4 py-1"
          disabled={!isStreamTransmitting}
          svg={Airplay}
          onClick={() => {
            dispatch(
              updateStream({
                slide: null,
                type: "clear",
                name: "",
              })
            );
            if (overlay.type === "participant") {
              dispatch(
                updateParticipantOverlayInfo({
                  name: overlay.name,
                  event: overlay.event,
                  title: overlay.title,
                  duration: overlay.duration,
                  id: overlay.id,
                  formatting: overlay.formatting,
                })
              );
            } else if (overlay.type === "stick-to-bottom") {
              dispatch(
                updateStbOverlayInfo({
                  heading: overlay.heading,
                  subHeading: overlay.subHeading,
                  duration: overlay.duration,
                  type: overlay.type,
                  id: overlay.id,
                  formatting: overlay.formatting,
                })
              );
            } else if (overlay.type === "qr-code") {
              dispatch(
                updateQrCodeOverlayInfo({
                  url: overlay.url,
                  description: overlay.description,
                  duration: overlay.duration,
                  type: overlay.type,
                  id: overlay.id,
                  formatting: overlay.formatting,
                })
              );
            } else if (overlay.type === "image") {
              dispatch(
                updateImageOverlayInfo({
                  imageUrl: overlay.imageUrl,
                  duration: overlay.duration,
                  type: overlay.type,
                  id: overlay.id,
                  formatting: overlay.formatting,
                })
              );
            }
          }}
        >
          Send
        </Button>
      )}
    </li>
  );
};

export default Overlay;
