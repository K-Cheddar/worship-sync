import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { default as CreditsContainer } from "../containers/Credits/Credits";
import { useDispatch, useSelector } from "../hooks";
import {
  initiatePublishedCreditsList,
  initiateTransitionScene,
} from "../store/creditsSlice";
import { onValue, ref } from "firebase/database";
import { GlobalInfoContext } from "../context/globalInfo";

const Credits = () => {
  const { publishedList, transitionScene } = useSelector(
    (state) => state.undoable.present.credits
  );
  const dispatch = useDispatch();
  const { user, firebaseDb } = useContext(GlobalInfoContext) || {};
  const [creditsTimeline, setCreditsTimeline] = useState<GSAPTimeline>();
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!firebaseDb || user === "Demo") return;

    const getPublishedRef = ref(
      firebaseDb,
      "users/" + user + "/v2/credits/publishedList"
    );
    onValue(getPublishedRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        dispatch(initiatePublishedCreditsList(data));
      }
    });

    const getTransitionSceneRef = ref(
      firebaseDb,
      "users/" + user + "/v2/credits/transitionScene"
    );
    onValue(getTransitionSceneRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        dispatch(initiateTransitionScene(data));
      }
    });
  }, [dispatch, firebaseDb, user]);

  useEffect(() => {
    window.addEventListener("obsSourceActiveChanged", (event) => {
      setIsActive(event.detail.active);
      if (event.detail.active) {
        creditsTimeline?.restart();
      }
    });
  }, [creditsTimeline]);

  const runObsTransition = useCallback(() => {
    if (isActive) {
      window.obsstudio?.setCurrentScene(transitionScene);
    }
  }, [transitionScene, isActive]);

  return (
    <CreditsContainer
      credits={publishedList}
      runObsTransition={runObsTransition}
      setCreditsTimeline={setCreditsTimeline}
    />
  );
};

export default Credits;
