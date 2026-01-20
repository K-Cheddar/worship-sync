import DisplayWindow from "../DisplayWindow/DisplayWindow";
import Toggle from "../Toggle/Toggle";
import QuickLink from "../QuickLink/QuickLink";
import {
  Presentation as PresentationType,
  QuickLinkType,
  TimerInfo,
} from "../../types";
import { MonitorX, MonitorUp } from "lucide-react";
import { useDispatch } from "../../hooks";
import {
  clearMonitor,
  clearProjector,
  clearStream,
} from "../../store/presentationSlice";
import Button from "../Button/Button";

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
  showMonitorClockTimer?: boolean;
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
  showMonitorClockTimer = false,
}: PresentationProps) => {
  const dispatch = useDispatch();

  const handleClear = () => {
    if (info.displayType === "projector") {
      dispatch(clearProjector());
    } else if (info.displayType === "monitor") {
      dispatch(clearMonitor());
    } else if (info.displayType === "stream") {
      dispatch(clearStream());
    }
  };

  const filteredQuickLinks = quickLinks.filter((link) => link.action !== "clear");

  return (
    <div className="flex flex-col gap-2">
      <section className="border border-gray-600 rounded-lg overflow-hidden relative bg-gray-800">
        <div className="flex gap-2">
          <div className="flex flex-col">
            <h2 className="bg-gray-900 text-center font-semibold text-sm flex items-center gap-2 px-2 py-1 justify-around">
              <span>{name}</span>
              <Button
                variant="tertiary"
                svg={MonitorX}
                onClick={handleClear}
                className="p-1"
                iconSize="md"
              />
              <Toggle
                icon={MonitorUp}
                value={isTransmitting}
                onChange={toggleIsTransmitting}
                color="#22c55e"
              />
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
              showMonitorClockTimer={showMonitorClockTimer}
            />
          </div>
          {filteredQuickLinks.length > 0 && (
              <ul className="grid grid-cols-2 gap-2 py-2 w-full pr-2">
                {filteredQuickLinks.map((link) => (
                  <QuickLink
                    timers={timers}
                    displayType={info.displayType}
                    isMobile={isMobile}
                    {...link}
                    key={link.id}
                  />
                ))}
              </ul>
          )}
        </div>
      </section>
    </div>
  );
};

export default Presentation;
