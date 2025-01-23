import { useCallback, useContext, useEffect, useState } from "react";
import Credits from "../containers/Credits/Credits";
import { default as CreditsEditorContainer } from "../containers/Credits/CreditsEditor";
// import { ReactComponent as BackArrowSVG } from "../assets/icons/arrow-back.svg";
import { useDispatch, useSelector } from "../hooks";
import { ControllerInfoContext } from "../context/controllerInfo";
import { DBCredits } from "../types";
import {
  initiateCreditsList,
  initiateTransitionScene,
  setIsLoading,
} from "../store/creditsSlice";
import Spinner from "../components/Spinner/Spinner";
import { GlobalInfoContext } from "../context/globalInfo";
import Button from "../components/Button/Button";
import cn from "classnames";
import { Link } from "react-router-dom";
import { onValue, ref } from "firebase/database";

const CreditsEditor = () => {
  const { list } = useSelector((state) => state.undoable.present.credits);
  const { db, dbProgress, setIsMobile } =
    useContext(ControllerInfoContext) || {};
  const { user, firebaseDb } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

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

    getTransitionScene();
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

  return (
    <div
      ref={editorRef}
      className="w-full h-screen bg-gray-700 text-white flex flex-col gap-2 overflow-hidden p-4"
    >
      <div>
        <Button variant="tertiary" className="w-fit" padding="p-0">
          <Link className="h-full w-full px-2 py-1" to="/">
            Back
          </Link>
        </Button>
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
        <div className="fixed top-0 left-0 z-50 bg-gray-800/85 w-full h-full flex justify-center items-center flex-col text-white text-2xl gap-8">
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

      <div className="flex gap-2">
        <CreditsEditorContainer
          className={isPreviewOpen ? "max-md:hidden" : ""}
        />

        <section
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
