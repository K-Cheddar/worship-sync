import Button from "../components/Button/Button";
import { ArrowLeft } from "lucide-react";
import Undo from "../containers/Toolbar/ToolbarElements/Undo";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import ServiceTimes from "../containers/ServiceTimes/ServiceTimes";
import { ControllerInfoContext } from "../context/controllerInfo";
import { useDispatch, useSelector } from "../hooks";
import { useSyncOnReconnect } from "../hooks";
import { useCallback, useContext, useEffect, useRef } from "react";
import { setIsInitialized as setServiceTimesIsInitialized } from "../store/serviceTimesSlice";
import { INFO_CONTROLLER_PAGE_READY, RootState } from "../store/store";

const InfoController = () => {
  const dispatch = useDispatch();
  const serviceTimesInitialized = useSelector(
    (state: RootState) => state.undoable.present.serviceTimes.isInitialized
  );
  const hasDispatchedPageReady = useRef(false);
  const { setIsMobile, setIsPhone, pullFromRemote } =
    useContext(ControllerInfoContext) || {};

  useSyncOnReconnect(pullFromRemote);

  useEffect(() => {
    return () => {
      dispatch(setServiceTimesIsInitialized(false));
    };
  }, [dispatch]);

  useEffect(() => {
    if (serviceTimesInitialized && !hasDispatchedPageReady.current) {
      hasDispatchedPageReady.current = true;
      dispatch({ type: INFO_CONTROLLER_PAGE_READY });
    }
  }, [serviceTimesInitialized, dispatch]);

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
    <main ref={infoControllerRef} className="flex flex-col h-dvh">
      <div className="bg-gray-800 w-full px-4 py-1 flex gap-2 items-center">
        <Button
          variant="tertiary"
          className="w-fit"
          padding="p-0"
          component="link"
          to="/"
          svg={ArrowLeft}
        />
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
