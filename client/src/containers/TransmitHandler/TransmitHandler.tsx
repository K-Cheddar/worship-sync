import { useContext, useEffect, useRef, useState } from "react";
import Toggle from "../../components/Toggle/Toggle";
import { useDispatch, useSelector } from "../../hooks";
import {
  setTransmitToAll,
  toggleMonitorTransmitting,
  toggleStreamTransmitting,
  toggleProjectorTransmitting,
  clearAll,
  updateMonitorFromRemote,
  updateProjectorFromRemote,
  updateStreamFromRemote,
  updateBibleDisplayInfoFromRemote,
  updateParticipantOverlayInfoFromRemote,
  updateStbOverlayInfoFromRemote,
} from "../../store/presentationSlice";
import Presentation from "../../components/Presentation/Presentation";
import { monitorLinks, projectorLinks, streamLinks } from "./dummyLinks";
import Button from "../../components/Button/Button";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ref, onValue, Unsubscribe } from "firebase/database";
import {
  BibleDisplayInfo,
  OverlayInfo,
  Presentation as PresentationType,
} from "../../types";
import { UnknownAction } from "@reduxjs/toolkit";

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
  const onValueRef = useRef<{
    projectorInfo: Unsubscribe | undefined;
    monitorInfo: Unsubscribe | undefined;
    streamInfo: Unsubscribe | undefined;
    stream_bibleInfo: Unsubscribe | undefined;
    stream_participantOverlayInfo: Unsubscribe | undefined;
    stream_stbOverlayInfo: Unsubscribe | undefined;
  }>({
    projectorInfo: undefined,
    monitorInfo: undefined,
    streamInfo: undefined,
    stream_bibleInfo: undefined,
    stream_participantOverlayInfo: undefined,
    stream_stbOverlayInfo: undefined,
  });

  const { firebaseDb, user } = useContext(GlobalInfoContext) || {};

  useEffect(() => {
    setIsTransmitting(
      isMonitorTransmitting && isProjectorTransmitting && isStreamTransmitting
    );
  }, [isMonitorTransmitting, isProjectorTransmitting, isStreamTransmitting]);

  useEffect(() => {
    if (!firebaseDb) return;

    const updateFromFirebase = (data: any) => {
      const _monitorInfo: PresentationType | undefined = data.monitorInfo;
      const _projectorInfo: PresentationType | undefined = data.projectorInfo;
      const _streamInfo: PresentationType | undefined = data.streamInfo;
      const _stream_bibleInfo: BibleDisplayInfo | undefined =
        data.stream_bibleInfo;
      const _stream_participantOverlayInfo: OverlayInfo | undefined =
        data.stream_participantOverlayInfo;
      const _stream_stbOverlayInfo: OverlayInfo | undefined =
        data.stream_stbOverlayInfo;

      type updateInfoChildType = {
        info: PresentationType | BibleDisplayInfo | OverlayInfo;
        updateFunction: (
          arg0: PresentationType | BibleDisplayInfo | OverlayInfo
        ) => UnknownAction;
        compareTo: PresentationType | BibleDisplayInfo | OverlayInfo;
      };

      const updateInfo = {
        monitorInfo: {
          info: _monitorInfo,
          updateFunction: updateMonitorFromRemote,
          compareTo: monitorInfo,
        },
        projectorInfo: {
          info: _projectorInfo,
          updateFunction: updateProjectorFromRemote,
          compareTo: projectorInfo,
        },
        streamInfo: {
          info: _streamInfo,
          updateFunction: updateStreamFromRemote,
          compareTo: streamInfo,
        },
        stream_bibleInfo: {
          info: _stream_bibleInfo,
          updateFunction: updateBibleDisplayInfoFromRemote,
          compareTo: streamInfo.bibleDisplayInfo,
        },
        stream_participantOverlayInfo: {
          info: _stream_participantOverlayInfo,
          updateFunction: updateParticipantOverlayInfoFromRemote,
          compareTo: streamInfo.participantOverlayInfo,
        },
        stream_stbOverlayInfo: {
          info: _stream_stbOverlayInfo,
          updateFunction: updateStbOverlayInfoFromRemote,
          compareTo: streamInfo.stbOverlayInfo,
        },
      };

      const keys = Object.keys(updateInfo);
      for (const key of keys) {
        const _key = key as keyof typeof updateInfo; // Define type
        const obj = updateInfo[_key];
        const { info, updateFunction, compareTo } = obj as updateInfoChildType;

        if (!info) continue; // nothing to update here.

        if (
          (info.time && compareTo?.time && info.time > compareTo.time) ||
          (info.time && !compareTo?.time)
        ) {
          dispatch(updateFunction({ ...info }));
        }
      }
    };

    // unsubscribe from any previous listeners
    if (onValueRef.current) {
      const keys = Object.keys(onValueRef.current);
      for (const key of keys) {
        const _key = key as keyof typeof onValueRef.current; // Define type
        onValueRef.current[_key]?.();

        const updateRef = ref(
          firebaseDb,
          "users/" + user + "/v2/presentation/" + key
        );

        onValueRef.current[_key] = onValue(updateRef, (snapshot) => {
          const data = snapshot.val();
          if (data) {
            updateFromFirebase({ [key]: data });
          }
        });
      }
    }
  }, [firebaseDb, user, monitorInfo, projectorInfo, streamInfo, dispatch]);

  const handleSetTransmitting = () => {
    setIsTransmitting(!isTransmitting);
    dispatch(setTransmitToAll(!isTransmitting));
  };

  console.log({ streamInfo });

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
