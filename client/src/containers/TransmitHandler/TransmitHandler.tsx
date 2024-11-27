import { useCallback, useContext, useEffect, useRef, useState } from "react";
import Toggle from "../../components/Toggle/Toggle";
import { useDispatch, useSelector } from "../../hooks";
import {
  setTransmitToAll,
  toggleMonitorTransmitting,
  toggleStreamTransmitting,
  toggleProjectorTransmitting,
  clearAll,
  updateMonitor,
  updateProjector,
  updateStream,
  updateBibleDisplayInfo,
  updateOverlayInfo,
} from "../../store/presentationSlice";
import Presentation from "../../components/Presentation/Presentation";
import { monitorLinks, projectorLinks, streamLinks } from "./dummyLinks";
import Button from "../../components/Button/Button";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ref, onValue, Unsubscribe } from "firebase/database";
import { Presentation as PresentationType } from "../../types";

const TransmitHandler = ({ className }: { className: string }) => {
  const {
    isMonitorTransmitting,
    isProjectorTransmitting,
    isStreamTransmitting,
    prevProjectorInfo,
    prevMonitorInfo,
    prevStreamInfo,
    projectorInfo,
    monitorInfo,
    streamInfo,
  } = useSelector((state) => state.presentation);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const dispatch = useDispatch();
  const onValueRef = useRef<Unsubscribe>();

  const { firebaseDb, user } = useContext(GlobalInfoContext) || {};

  // const updateFromFirebase = useCallback(
  //   (data: any) => {
  //     const _monitorInfo: PresentationType = data.monitorInfo;
  //     const _projectorInfo: PresentationType = data.projectorInfo;
  //     const _streamInfo: PresentationType = data.streamInfo;

  //     console.log({
  //       monitorInfo,
  //       _monitorInfo,
  //       projectorInfo,
  //       _projectorInfo,
  //       streamInfo,
  //       _streamInfo,
  //     });

  //     if (
  //       _monitorInfo.time &&
  //       monitorInfo.time &&
  //       _monitorInfo.time > monitorInfo.time
  //     ) {
  //       // dispatch(updateMonitor(_monitorInfo));
  //     }

  //     if (
  //       _projectorInfo.time &&
  //       projectorInfo.time &&
  //       _projectorInfo.time > projectorInfo.time
  //     ) {
  //       // dispatch(updateProjector(_projectorInfo));
  //     }

  //     if (
  //       _streamInfo.time &&
  //       streamInfo.time &&
  //       _streamInfo.time > streamInfo.time
  //     ) {
  //       // dispatch(updateStream(_streamInfo));
  //     }
  //   },
  //   [dispatch, monitorInfo, projectorInfo, streamInfo]
  // );

  useEffect(() => {
    setIsTransmitting(
      isMonitorTransmitting && isProjectorTransmitting && isStreamTransmitting
    );
  }, [isMonitorTransmitting, isProjectorTransmitting, isStreamTransmitting]);

  useEffect(() => {
    if (!firebaseDb) return;

    const updateFromFirebase = (data: any) => {
      const _monitorInfo: PresentationType = data.monitorInfo;
      const _projectorInfo: PresentationType = data.projectorInfo;
      const _streamInfo: PresentationType = data.streamInfo;

      console.log({
        monitorInfo,
        _monitorInfo,
        projectorInfo,
        _projectorInfo,
        streamInfo,
        _streamInfo,
      });

      if (
        (_monitorInfo.time &&
          monitorInfo.time &&
          _monitorInfo.time > monitorInfo.time) ||
        (_monitorInfo.time && !monitorInfo.time)
      ) {
        dispatch(
          updateMonitor({ ..._monitorInfo, ignoreIsTransmitting: true })
        );
      }

      if (
        (_projectorInfo.time &&
          projectorInfo.time &&
          _projectorInfo.time > projectorInfo.time) ||
        (_projectorInfo.time && !projectorInfo.time)
      ) {
        dispatch(
          updateProjector({ ..._projectorInfo, ignoreIsTransmitting: true })
        );
      }

      if (
        (_streamInfo.time &&
          streamInfo.time &&
          _streamInfo.time > streamInfo.time) ||
        (_streamInfo.time && !streamInfo.time)
      ) {
        dispatch(updateStream({ ..._streamInfo, ignoreIsTransmitting: true }));
        if (_streamInfo.bibleDisplayInfo) {
          dispatch(
            updateBibleDisplayInfo({
              ..._streamInfo.bibleDisplayInfo,
              ignoreIsTransmitting: true,
            })
          );
        }
        if (_streamInfo.flOverlayInfo) {
          dispatch(
            updateOverlayInfo({
              ..._streamInfo.flOverlayInfo,
              ignoreIsTransmitting: true,
            })
          );
        }
        if (_streamInfo.stbOverlayInfo) {
          dispatch(
            updateOverlayInfo({
              ..._streamInfo.stbOverlayInfo,
              ignoreIsTransmitting: true,
            })
          );
        }
      }
    };

    if (onValueRef.current) {
      onValueRef.current();
    }

    const presentationRef = ref(
      firebaseDb,
      "users/" + user + "/v2/presentation"
    );

    onValueRef.current = onValue(presentationRef, (snapshot) => {
      const data = snapshot.val();
      updateFromFirebase(data);
    });
  }, [firebaseDb, user, monitorInfo, projectorInfo, streamInfo]);

  const handleSetTransmitting = () => {
    setIsTransmitting(!isTransmitting);
    dispatch(setTransmitToAll(!isTransmitting));
  };

  return (
    <section className={className}>
      <div className="w-full flex justify-center items-center gap-4">
        <Button
          onClick={() => dispatch(clearAll())}
          className="text-sm"
          padding="py-1 px-2"
        >
          Clear All
        </Button>
        <hr className="border-r border-slate-400 h-full" />
        <Toggle
          label="Sending to all"
          value={isTransmitting}
          onChange={handleSetTransmitting}
        />
      </div>
      <Presentation
        name="Projector"
        prevInfo={prevProjectorInfo}
        info={projectorInfo}
        isTransmitting={isProjectorTransmitting}
        toggleIsTransmitting={() => dispatch(toggleProjectorTransmitting())}
        quickLinks={projectorLinks}
      />
      <Presentation
        name="Monitor"
        prevInfo={prevMonitorInfo}
        info={monitorInfo}
        isTransmitting={isMonitorTransmitting}
        toggleIsTransmitting={() => dispatch(toggleMonitorTransmitting())}
        quickLinks={monitorLinks}
      />
      <Presentation
        name="Stream"
        prevInfo={prevStreamInfo}
        info={streamInfo}
        isTransmitting={isStreamTransmitting}
        toggleIsTransmitting={() => dispatch(toggleStreamTransmitting())}
        quickLinks={streamLinks}
      />
    </section>
  );
};

export default TransmitHandler;
