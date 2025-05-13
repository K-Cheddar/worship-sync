import { useCallback, useContext, useEffect, useState } from "react";
import { default as CreditsContainer } from "../containers/Credits/Credits";
import { useDispatch, useSelector } from "../hooks";
import {
  initiateCreditsScene,
  initiatePublishedCreditsList,
  initiateTransitionScene,
} from "../store/creditsSlice";
import { onValue, ref } from "firebase/database";
import { GlobalInfoContext } from "../context/globalInfo";

const Credits = () => {
  const { publishedList, transitionScene, creditsScene } = useSelector(
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

    const getCreditsSceneRef = ref(
      firebaseDb,
      "users/" + user + "/v2/credits/creditsScene"
    );
    onValue(getCreditsSceneRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        dispatch(initiateCreditsScene(data));
      }
    });
  }, [dispatch, firebaseDb, user]);

  const runObsTransition = useCallback(() => {
    if (isActive) {
      window.obsstudio?.setCurrentScene(transitionScene);
    }
  }, [transitionScene, isActive]);

  useEffect(() => {
    window.obsstudio?.getCurrentScene((scene) => {
      setIsActive(scene?.name === creditsScene);
    });
  }, [creditsScene]);

  return (
    <CreditsContainer
      credits={publishedList}
      runObsTransition={runObsTransition}
      setCreditsTimeline={setCreditsTimeline}
    />
  );
};

export default Credits;
