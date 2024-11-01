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
};

const Presentation = ({
  name,
  prevInfo,
  info,
  isTransmitting,
  toggleIsTransmitting,
  quickLinks,
  showBorder = true,
}: PresentationProps) => {
  return (
    <div className="flex gap-2">
      <section className="w-fit">
        <h2 className="bg-slate-900 text-center font-semibold text-base">
          {name}
        </h2>
        <DisplayWindow
          boxes={info.slide?.boxes || []}
          prevBoxes={prevInfo.slide?.boxes || []}
          width={14}
          showBorder={showBorder}
          displayType={info.displayType}
          overlayInfo={info.overlayInfo}
          prevOverlayInfo={prevInfo.overlayInfo}
          time={info.time}
          prevTime={prevInfo.time}
          shouldAnimate
        />
      </section>
      <section className="gap-2 flex flex-col pt-2">
        <Toggle
          label="Transmitting"
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
