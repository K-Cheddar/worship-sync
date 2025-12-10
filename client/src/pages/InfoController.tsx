import Button from "../components/Button/Button";
import { ReactComponent as BackArrowSVG } from "../assets/icons/arrow-back.svg";
import Undo from "../containers/Toolbar/ToolbarElements/Undo";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import ServiceTimes from "../containers/ServiceTimes/ServiceTimes";
import { ControllerInfoContext } from "../context/controllerInfo";
import { useContext } from "react";
import { useCallback } from "react";

const InfoController = () => {
  const { setIsMobile, setIsPhone } = useContext(ControllerInfoContext) || {};

  const infoControllerRef = useCallback(
    (node: HTMLDivElement) => {
      if (node) {
        const resizeObserver = new ResizeObserver((entries) => {
          const width = entries[0].borderBoxSize[0].inlineSize;
          if (width < 576) {
            setIsPhone?.(true);
          } else {
            setIsPhone?.(false);
          }
          if (width < 768) {
            setIsMobile?.(true);
          } else {
            setIsMobile?.(false);
          }
        });

        resizeObserver.observe(node);
      }
    },
    [setIsMobile, setIsPhone]
  );

  return (
    <main ref={infoControllerRef} className="flex flex-col h-screen">
      <div className="bg-gray-800 w-full px-4 py-1 flex gap-2 items-center">
        <Button
          variant="tertiary"
          className="w-fit"
          padding="p-0"
          component="link"
          to="/"
        >
          <BackArrowSVG />
        </Button>
        <div className="border-l-2 border-gray-400 pl-4">
          <Undo />
        </div>
        <div className="ml-auto">
          <UserSection />
        </div>
      </div>
      <ServiceTimes />
    </main>
  );
};

export default InfoController;
