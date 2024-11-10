import { CSSProperties, useRef } from "react";
import {
  BibleDisplayInfo,
  Box,
  DisplayType,
  ParticipantInfo,
} from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";
import DisplayBox from "./DisplayBox";

type DisplayWindowProps = {
  prevBoxes?: Box[];
  boxes?: Box[];
  onChange?: ({
    index,
    value,
    box,
    cursorPosition,
  }: {
    index: number;
    value: string;
    box: Box;
    cursorPosition: number;
  }) => void;
  width: number;
  showBorder?: boolean;
  displayType?: DisplayType;
  prevParticipantInfo?: ParticipantInfo;
  participantInfo?: ParticipantInfo;
  bibleDisplayInfo?: BibleDisplayInfo;
  prevBibleDisplayInfo?: BibleDisplayInfo;
  shouldAnimate?: boolean;
  time?: number;
  prevTime?: number;
};

const DisplayWindow = ({
  prevBoxes = [],
  boxes = [],
  onChange,
  width,
  showBorder = false,
  displayType,
  prevParticipantInfo,
  participantInfo = {},
  shouldAnimate = false,
  time,
  prevTime,
  bibleDisplayInfo,
  prevBibleDisplayInfo,
}: DisplayWindowProps) => {
  const containerRef = useRef<HTMLUListElement | null>(null);
  const participantRef = useRef<HTMLLIElement | null>(null);
  const bibleRef = useRef<HTMLLIElement | null>(null);
  const prevBibleRef = useRef<HTMLLIElement | null>(null);
  const participantTimeline = useRef<GSAPTimeline | null>();
  const bibleTimeline = useRef<GSAPTimeline | null>();
  const prevBibleTimeline = useRef<GSAPTimeline | null>();
  // const prevParticipantRef = useRef<HTMLDivElement | null>(null);

  const aspectRatio = 16 / 9;
  const fontAdjustment = width === 42 ? 1 : 42.35 / width; // Display editor is 42vw but sometimes the display gets clipped on other windows

  const showBackground =
    displayType === "projector" ||
    displayType === "slide" ||
    displayType === "editor";
  const isStream = displayType === "stream";

  useGSAP(
    () => {
      if (
        !participantRef.current ||
        !containerRef.current ||
        !shouldAnimate ||
        !isStream
      )
        return;

      participantTimeline.current?.clear();

      const innerElements = [
        ".participant-info-name",
        ".participant-info-title",
        ".participant-info-event",
      ];
      const targets = [participantRef.current, ...innerElements];

      participantTimeline.current = gsap
        .timeline()
        .set(targets, { xPercent: -100 });

      // Only play animate if there is participant info
      if (
        participantInfo.name ||
        participantInfo.title ||
        participantInfo.event
      ) {
        participantTimeline.current
          .to(participantRef.current, {
            xPercent: 10,
            duration: 1,
            ease: "power1.inOut",
          })
          .to(
            innerElements,
            { xPercent: 0, duration: 1, ease: "power1.inOut", stagger: 0.2 },
            "-=0.75"
          )
          .to(targets, {
            xPercent: -100,
            duration: 1,
            ease: "power1.inOut",
            delay: 7,
          });
      }
    },
    { scope: participantRef, dependencies: [participantInfo] }
  );

  useGSAP(
    () => {
      if (
        !bibleRef.current ||
        !containerRef.current ||
        !shouldAnimate ||
        !isStream
      )
        return;

      bibleTimeline.current?.clear();

      const innerElements = [".bible-info-title", ".bible-info-text"];
      const targets = [bibleRef.current, ...innerElements];

      if (prevBibleDisplayInfo?.title?.trim()) {
        bibleTimeline.current = gsap
          .timeline()
          .set(targets, {
            opacity: 0,
            yPercent: 0,
          })
          .to(targets, { opacity: 1, duration: 0.35, ease: "power1.inOut" });
      } else {
        bibleTimeline.current = gsap.timeline().set(targets, { yPercent: 100 });

        // Only play animate if there is bible info
        if (bibleDisplayInfo?.title?.trim() || bibleDisplayInfo?.text?.trim()) {
          bibleTimeline.current.to(targets, {
            yPercent: 0,
            duration: 1,
            ease: "power1.inOut",
          });
        }
      }
    },
    { scope: bibleRef, dependencies: [bibleDisplayInfo] }
  );

  useGSAP(
    () => {
      if (
        !prevBibleRef.current ||
        !containerRef.current ||
        !shouldAnimate ||
        !isStream
      )
        return;

      prevBibleTimeline.current?.clear();

      const innerElements = [".prev-bible-info-title", ".prev-bible-info-text"];
      const targets = [prevBibleRef.current, ...innerElements];

      if (bibleDisplayInfo?.title) {
        prevBibleTimeline.current = gsap
          .timeline()
          .set(targets, {
            opacity: 1,
            yPercent: 0,
          })
          .to(targets, { opacity: 0, duration: 0.35, ease: "power1.inOut" });
      } else {
        prevBibleTimeline.current = gsap
          .timeline()
          .set(targets, { yPercent: 0, opacity: 1 })
          .to(targets, {
            yPercent: 100,
            duration: 1,
            ease: "power1.inOut",
          });
      }
    },
    { scope: prevBibleRef, dependencies: [prevBibleDisplayInfo] }
  );

  // useGSAP(() => {
  //   if (!prevParticipantRef.current) return;
  //   const width = prevParticipantRef.current.offsetWidth
  //   gsap.fromTo(prevParticipantRef.current, { x: 0 }, { x: -width - 16, duration: 0.5 });
  // }, { dependencies: [prevParticipantInfo] })

  return (
    <ul
      className={`display-window ${
        showBorder ? "border border-gray-500" : ""
      } ${displayType !== "stream" ? "bg-black" : ""}`}
      ref={containerRef}
      style={
        {
          "--slide-editor-height": `${width / aspectRatio}vw`,
          "--slide-editor-width": `${width}vw`,
        } as React.CSSProperties
      }
    >
      {boxes.map((box, index) => {
        return (
          <DisplayBox
            key={box.id}
            box={box}
            width={width}
            displayType={displayType}
            showBackground={showBackground}
            isStream={isStream}
            fontAdjustment={fontAdjustment}
            onChange={onChange}
            index={index}
            shouldAnimate={shouldAnimate}
            prevBox={prevBoxes[index]}
            time={time}
          />
        );
      })}
      {prevBoxes.map((box, index) => {
        return (
          <DisplayBox
            key={box.id}
            box={box}
            width={width}
            displayType={displayType}
            showBackground={showBackground}
            isStream={isStream}
            fontAdjustment={fontAdjustment}
            onChange={onChange}
            index={index}
            shouldAnimate={shouldAnimate}
            isPrev
            time={prevTime}
          />
        );
      })}

      {/* {hasPrevParticipantData && (
        <div 
          ref={prevParticipantRef}
          className="participant-info-container"
          style={{
            '--participant-info-border-width' :`${width / 71.4}vw`,
            '--participant-info-name-size': `${width / 31.3}vw`,
            '--participant-info-title-size': `${width / 41.2}vw`,
            '--participant-info-event-size': `${width / 50}vw`,
          } as CSSProperties}
        >
          {prevParticipantInfo.name && <p className="participant-info-name">{prevParticipantInfo.name}</p>}
          {prevParticipantInfo.title && <p className="participant-info-title">{prevParticipantInfo.title}</p>}
          {prevParticipantInfo.event && <p className="participant-info-event">{prevParticipantInfo.event}</p>}         
      </div>
     )} */}

      {isStream && (
        <li
          ref={bibleRef}
          className="bible-info-container"
          style={
            {
              "--bible-info-border-width": `${width / 71.4}vw`,
              "--bible-info-title-size": `${width / 42.3}vw`,
              "--bible-info-text-size": `${width / 38.2}vw`,
            } as CSSProperties
          }
        >
          {bibleDisplayInfo?.title?.trim() && (
            <p className="bible-info-title">{bibleDisplayInfo.title}</p>
          )}
          {bibleDisplayInfo?.text?.trim() && (
            <p className="bible-info-text">{bibleDisplayInfo.text}</p>
          )}
        </li>
      )}

      {isStream && (
        <li
          ref={prevBibleRef}
          className="prev-bible-info-container"
          style={
            {
              "--bible-info-border-width": `${width / 71.4}vw`,
              "--bible-info-title-size": `${width / 42.3}vw`,
              "--bible-info-text-size": `${width / 38.2}vw`,
            } as CSSProperties
          }
        >
          {prevBibleDisplayInfo?.title?.trim() && (
            <p className="prev-bible-info-title">
              {prevBibleDisplayInfo.title}
            </p>
          )}
          {prevBibleDisplayInfo?.text?.trim() && (
            <p className="prev-bible-info-text">{prevBibleDisplayInfo.text}</p>
          )}
        </li>
      )}

      {isStream && (
        <li
          ref={participantRef}
          className="participant-info-container"
          style={
            {
              "--participant-info-border-width": `${width / 71.4}vw`,
              "--participant-info-name-size": `${width / 31.3}vw`,
              "--participant-info-title-size": `${width / 41.2}vw`,
              "--participant-info-event-size": `${width / 50}vw`,
            } as CSSProperties
          }
        >
          {participantInfo.name && (
            <p className="participant-info-name">{participantInfo.name}</p>
          )}
          {participantInfo.title && (
            <p className="participant-info-title">{participantInfo.title}</p>
          )}
          {participantInfo.event && (
            <p className="participant-info-event">{participantInfo.event}</p>
          )}
        </li>
      )}
    </ul>
  );
};

export default DisplayWindow;
