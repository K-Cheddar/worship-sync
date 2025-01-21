import { CreditsInfo } from "../../types";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import cn from "classnames";
import { useMemo, useRef } from "react";
import "./Credits.scss";

const Credits = ({
  credits,
  isPreview = false,
}: {
  credits: CreditsInfo[];
  isPreview?: boolean;
}) => {
  const containerRef = useRef<HTMLUListElement>(null);

  const adjustedCredits = useMemo(
    () => [
      ...(!isPreview
        ? [{ heading: "", id: "starting-credits", text: "" }]
        : []),
      ...credits.map((credit) => credit),
      ...(!isPreview ? [{ heading: "", id: "ending-credits", text: "" }] : []),
    ],
    [credits, isPreview]
  );

  useGSAP(
    () => {
      if (!containerRef.current || isPreview || credits.length === 0) return;

      gsap.to(containerRef.current, {
        scrollTo: "#ending-credits",
        duration: credits.length * 2,
        ease: "none",
      });
    },
    { scope: containerRef, dependencies: [isPreview, credits] }
  );

  return (
    <ul
      ref={containerRef}
      className={cn(
        "credits-list",
        !isPreview && "published-credits-list",
        isPreview && "h-full max-h-full"
      )}
    >
      {adjustedCredits.map(({ heading, id, text }) => {
        const isEnding = id === "ending-credits";
        const isStarting = id === "starting-credits";
        return (
          <li key={id} id={`credits-${id}`}>
            {id === "starting-credits" && (
              <div id={id} className="mb-[100vh]" />
            )}
            {id === "ending-credits" && <div id={id} className="mt-[100vh]" />}

            {!isStarting && !isEnding && (
              <>
                <h2 className="text-[1.75vw] max-md:text-[3.5vw] font-semibold">
                  {heading}
                </h2>
                <p className="text-[1.5vw] max-md:text-[3vw] whitespace-pre-line">
                  {text}
                </p>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default Credits;
