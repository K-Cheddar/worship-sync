import DisplayWindow from "../DisplayWindow/DisplayWindow";
import Toggle from "../Toggle/Toggle";
import QuickLink from "../QuickLink/QuickLink";
import {
  Presentation as PresentationType,
  QuickLinkType,
  TimerInfo,
} from "../../types";

type PresentationProps = {
  name: string;
  info: PresentationType;
  prevInfo: PresentationType;
  isTransmitting: boolean;
  toggleIsTransmitting: () => void;
  quickLinks: QuickLinkType[];
  showBorder?: boolean;
  isMobile?: boolean;
  timerInfo?: TimerInfo;
  prevTimerInfo?: TimerInfo;
  timers: TimerInfo[];
};

const Presentation = ({
  name,
  prevInfo,
  info,
  isTransmitting,
  toggleIsTransmitting,
  quickLinks,
  showBorder = true,
  isMobile,
  timerInfo,
  prevTimerInfo,
  timers,
}: PresentationProps) => {
  return (
    <div className="flex gap-2">
      <section className="w-fit">
        <h2 className="bg-gray-900 text-center font-semibold text-base">
          {name}
        </h2>
        <DisplayWindow
          boxes={info.slide?.boxes || []}
          prevBoxes={prevInfo.slide?.boxes || []}
          width={isMobile ? 32 : 14}
          showBorder={showBorder}
          displayType={info.displayType}
          participantOverlayInfo={info.participantOverlayInfo}
          prevParticipantOverlayInfo={prevInfo.participantOverlayInfo}
          stbOverlayInfo={info.stbOverlayInfo}
          prevStbOverlayInfo={prevInfo.stbOverlayInfo}
          qrCodeOverlayInfo={info.qrCodeOverlayInfo}
          prevQrCodeOverlayInfo={prevInfo.qrCodeOverlayInfo}
          imageOverlayInfo={info.imageOverlayInfo}
          prevImageOverlayInfo={prevInfo.imageOverlayInfo}
          prevBibleDisplayInfo={prevInfo.bibleDisplayInfo}
          bibleDisplayInfo={info.bibleDisplayInfo}
          formattedTextDisplayInfo={info.formattedTextDisplayInfo}
          prevFormattedTextDisplayInfo={prevInfo.formattedTextDisplayInfo}
          timerInfo={timerInfo}
          prevTimerInfo={prevTimerInfo}
          time={info.time}
          prevTime={prevInfo.time}
          shouldAnimate
          shouldPlayVideo
        />
      </section>
      <section className="gap-2 max-lg:gap-6 flex flex-col pt-2">
        <Toggle
          label="Sending"
          value={isTransmitting}
          onChange={toggleIsTransmitting}
          color="#22c55e"
        />
        <section className="grid grid-cols-2 gap-2">
          {quickLinks.map((link) => (
            <QuickLink
              timers={timers}
              displayType={info.displayType}
              isMobile={isMobile}
              {...link}
              key={link.id}
            />
          ))}
        </section>
      </section>
    </div>
  );
};

export default Presentation;
