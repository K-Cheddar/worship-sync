import { useCallback, useContext, useEffect, useState } from "react";
import Credits from "../../containers/Credits/Credits";
import { default as CreditsEditorContainer } from "../../containers/Credits/CreditsEditor";
import { ReactComponent as BackArrowSVG } from "../../assets/icons/arrow-back.svg";
import { ReactComponent as ExpandSVG } from "../../assets/icons/expand.svg";
import { ReactComponent as SyncSVG } from "../../assets/icons/sync-alt.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { useDispatch, useSelector } from "../../hooks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { DBCredits } from "../../types";
import {
  initiateCreditsList,
  initiateCreditsScene,
  initiateTransitionScene,
  setCreditsScene,
  setIsLoading,
  setTransitionScene,
  updateCreditsListFromRemote,
  updateList,
} from "../../store/creditsSlice";
import Spinner from "../../components/Spinner/Spinner";
import { GlobalInfoContext } from "../../context/globalInfo";
import Button from "../../components/Button/Button";
import cn from "classnames";
import { Link } from "react-router-dom";
import { onValue, ref } from "firebase/database";
import PopOver from "../../components/PopOver/PopOver";
import Input from "../../components/Input/Input";
import "./CreditsEditor.scss";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import Undo from "../../containers/Toolbar/ToolbarElements/Undo";
import getScheduleFromExcel from "../../utils/getScheduleFromExcel";

const CreditsEditor = () => {
  const { list, transitionScene, creditsScene } = useSelector(
    (state) => state.undoable.present.credits
  );
  const { list: overlays } = useSelector(
    (state) => state.undoable.present.overlays
  );
  const { db, dbProgress, setIsMobile, updater } =
    useContext(ControllerInfoContext) || {};
  const { user, firebaseDb } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const getCredits = async () => {
      if (!db) return;

      try {
        const response: DBCredits = await db.get("credits");
        dispatch(initiateCreditsList(response.list));
        dispatch(setIsLoading(false));
      } catch (error: any) {
        console.error(error);
        dispatch(initiateCreditsList([]));
        if (error.name === "not_found") db.put({ _id: "credits", list: [] });
        dispatch(setIsLoading(false));
      }
    };

    getCredits();
  }, [db, dispatch]);

  useEffect(() => {
    if (!updater) return;
    const updateAllItemsAndList = async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          // check if the list we have selected was updated
          if (_update._id === "credits") {
            console.log("updating credits list from remote", event);
            const creditsUpdate = _update as DBCredits;
            dispatch(updateCreditsListFromRemote(creditsUpdate.list));
          }
        }
      } catch (e) {
        console.error(e);
      }
    };

    updater.addEventListener("update", updateAllItemsAndList);

    return () => updater.removeEventListener("update", updateAllItemsAndList);
  }, [updater, dispatch]);

  useEffect(() => {
    const getTransitionScene = async () => {
      if (!firebaseDb) return;
      const updateRef = ref(
        firebaseDb,
        "users/" + user + "/v2/credits/transitionScene"
      );
      onValue(updateRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(initiateTransitionScene(data));
        }
      });
    };

    const getCreditsScene = async () => {
      if (!firebaseDb) return;
      const updateRef = ref(
        firebaseDb,
        "users/" + user + "/v2/credits/creditsScene"
      );
      onValue(updateRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(initiateCreditsScene(data));
        }
      });
    };

    getTransitionScene();
    getCreditsScene();
  }, [dispatch, firebaseDb, user]);

  const editorRef = useCallback(
    (node: HTMLDivElement) => {
      if (node) {
        const resizeObserver = new ResizeObserver((entries) => {
          const width = entries[0].borderBoxSize[0].inlineSize;
          if (width < 1024) {
            setIsMobile?.(true);
          } else {
            setIsMobile?.(false);
          }
        });

        resizeObserver.observe(node);
      }
    },
    [setIsMobile]
  );

  useEffect(() => {
    // Scroll to top because body is overflowing (need to figure out how to prevent this)
    window.scrollTo(0, 0);
  }, []);

  const generateFromOverlays = useCallback(async () => {
    setIsGenerating(true);
    try {
      const eventNameMapping: { [key: string]: string } = {
        "sabbath school": overlays
          .filter((overlay) =>
            overlay.event?.toLowerCase().includes("sabbath school")
          )
          .map((overlay) => overlay.name)
          .join("\n")
          .trim(),
        welcome:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("welcome")
          )?.name || "",
        "call to praise":
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("call to praise")
          )?.name || "",
        invocation:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("invocation")
          )?.name || "",
        reading:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("reading")
          )?.name || "",
        intercessor:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("intercessor")
          )?.name || "",
        offertory:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("offertory")
          )?.name || "",
        special:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("special")
          )?.name || "",
        sermon:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("sermon")
          )?.name || "",
      };

      const schedule = await getScheduleFromExcel(
        "2nd Quarter 2025 - Schedule.xlsx",
        "/Media Team Positions.xlsx"
      );

      let updatedList = list.map((credit) => {
        // Find matching schedule entry
        const scheduleEntry = schedule.find(
          (entry) =>
            entry.heading.toLowerCase() === credit.heading.toLowerCase()
        );

        if (scheduleEntry) {
          return {
            ...credit,
            text: scheduleEntry.names,
          };
        }

        // If no schedule match, try overlay mapping
        const eventKey = Object.keys(eventNameMapping).find((key) =>
          credit.heading.toLowerCase().includes(key)
        );

        if (eventKey) {
          return {
            ...credit,
            text: eventNameMapping[eventKey],
          };
        }

        return credit;
      });

      // Replace & and , with new lines, then trim spaces
      updatedList = updatedList.map((credit) => {
        return {
          ...credit,
          text: credit.text
            .split(/,|&/)
            .map((item: string) => item.trim())
            .join("\n"),
        };
      });

      dispatch(updateList(updatedList));
      setJustGenerated(true);
      setTimeout(() => setJustGenerated(false), 2000);
    } catch (error) {
      console.error("Error generating from overlays:", error);
    } finally {
      setIsGenerating(false);
    }
  }, [overlays, list, dispatch]);

  const controls = (
    <>
      <Input
        label="Transition Scene"
        className="credits-transition-input"
        value={transitionScene}
        data-ignore-undo="true"
        onChange={(val) => dispatch(setTransitionScene(val as string))}
      />
      <Input
        label="Credits Scene"
        className="credits-transition-input"
        value={creditsScene}
        data-ignore-undo="true"
        onChange={(val) => dispatch(setCreditsScene(val as string))}
      />
      <Button
        className="text-sm"
        data-testid="generate-credits-button"
        disabled={overlays.length === 0 || isGenerating}
        onClick={() => {
          generateFromOverlays();
        }}
        color={justGenerated ? "#84cc16" : "#22d3ee"}
        svg={justGenerated ? CheckSVG : SyncSVG}
      >
        {isGenerating
          ? "Generating Credits..."
          : justGenerated
          ? "Generated Credits!"
          : "Generate Credits"}
      </Button>
    </>
  );

  return (
    <div
      ref={editorRef}
      className="w-full h-screen bg-gray-700 text-white flex flex-col gap-2 overflow-hidden"
    >
      <div>
        <div className="bg-gray-800 w-full px-4 py-1 flex gap-2 items-center">
          <Button variant="tertiary" className="w-fit" padding="p-0">
            <Link className="h-full w-full px-2 py-1" to="/">
              <BackArrowSVG />
            </Link>
          </Button>
          <div className="border-l-2 border-gray-400 pl-4">
            <Undo />
          </div>
          <div className="max-md:hidden flex gap-8 items-center border-l-2 border-gray-400 pl-4">
            {controls}
          </div>
          <PopOver
            TriggeringButton={
              <Button className="md:hidden" variant="tertiary" svg={ExpandSVG}>
                Tools
              </Button>
            }
          >
            <div className="flex flex-col gap-4 items-center p-4">
              {controls}
            </div>
          </PopOver>
          <div className="ml-auto">
            <UserSection />
          </div>
        </div>
        <div className="md:hidden flex items-center mt-2">
          <Button
            variant={isPreviewOpen ? "secondary" : "primary"}
            onClick={() => setIsPreviewOpen(false)}
            className="flex-1 justify-center rounded-r-none"
          >
            Show Editor
          </Button>
          <Button
            variant={isPreviewOpen ? "primary" : "secondary"}
            onClick={() => setIsPreviewOpen(true)}
            className="flex-1 justify-center rounded-l-none"
          >
            Show Preview
          </Button>
        </div>
      </div>

      {dbProgress !== 100 && (
        <div
          data-testid="loading-overlay"
          className="fixed top-0 left-0 z-50 bg-gray-800/85 w-full h-full flex justify-center items-center flex-col text-white text-2xl gap-8"
        >
          <p>
            Setting up <span className="font-bold">Worship</span>
            <span className="text-orange-500 font-semibold">Sync</span> for{" "}
            <span className="font-semibold">{user}</span>
          </p>
          <Spinner />
          <p>
            Progress: <span className="text-orange-500">{dbProgress}%</span>
          </p>
        </div>
      )}

      <div className="flex gap-2 px-4 pb-4">
        <CreditsEditorContainer
          className={isPreviewOpen ? "max-md:hidden" : ""}
        />

        <section
          data-testid="credits-preview-container"
          className={cn(
            "flex-1 text-center",
            !isPreviewOpen && "max-md:hidden"
          )}
        >
          <h2 className="text-lg font-semibold">Preview</h2>
          <Credits isPreview credits={list} />
        </section>
      </div>
    </div>
  );
};

export default CreditsEditor;
