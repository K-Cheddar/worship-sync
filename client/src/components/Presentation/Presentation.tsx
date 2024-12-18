import DisplayWindow from "../DisplayWindow/DisplayWindow";
import Toggle from "../Toggle/Toggle";
import QuickLink from "../QuickLink/QuickLink";
import { Presentation as PresentationType, QuickLinkType } from "../../types";

type PresentationProps = {
  name: string;
  info: PresentationType;
  prevInfo: PresentationType;
  isTransmitting: boolean;
  toggleIsTransmitting: () => void;
  quickLinks: QuickLinkType[];
  showBorder?: boolean;
  isMobile?: boolean;
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
          prevOverlayInfo={prevInfo.participantOverlayInfo}
          stbOverlayInfo={info.stbOverlayInfo}
          qrCodeOverlayInfo={info.qrCodeOverlayInfo}
          prevBibleDisplayInfo={prevInfo.bibleDisplayInfo}
          bibleDisplayInfo={info.bibleDisplayInfo}
          time={info.time}
          prevTime={prevInfo.time}
          shouldAnimate
          shouldPlayVideo
        />
      </section>
      <section className="gap-2 flex flex-col pt-2">
        <Toggle
          label="Sending"
          value={isTransmitting}
          onChange={toggleIsTransmitting}
        />
        <section className="grid grid-cols-2">
          {quickLinks.map((link) => (
            <QuickLink displayType={info.displayType} {...link} key={link.id} />
          ))}
        </section>
      </section>
    </div>
  );
};

export default Presentation;
