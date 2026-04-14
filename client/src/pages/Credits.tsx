import { useCallback, useContext, useEffect, useState } from "react";
import { default as CreditsContainer } from "../containers/Credits/Credits";
import { useDispatch, useSelector } from "../hooks";
import {
  initiateCreditsScene,
  initiateLiveCredits,
  initiateTransitionScene,
} from "../store/creditsSlice";
import { onValue, ref } from "firebase/database";
import { GlobalInfoContext } from "../context/globalInfo";
import { getChurchDataPath } from "../utils/firebasePaths";

const Credits = () => {
  const { liveCredits, transitionScene, creditsScene } = useSelector(
    (state) => state.undoable.present.credits,
  );
  const dispatch = useDispatch();
  const { churchId, firebaseDb, loginState } =
    useContext(GlobalInfoContext) || {};
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!firebaseDb || loginState === "guest") return;

    const liveCreditsRtdbRef = ref(
      firebaseDb,
      getChurchDataPath(churchId, "credits", "publishedList"),
    );
    onValue(liveCreditsRtdbRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        dispatch(initiateLiveCredits(data));
      }
    });

    const getTransitionSceneRef = ref(
      firebaseDb,
      getChurchDataPath(churchId, "credits", "transitionScene"),
    );
    onValue(getTransitionSceneRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        dispatch(initiateTransitionScene(data));
      }
    });

    const getCreditsSceneRef = ref(
      firebaseDb,
      getChurchDataPath(churchId, "credits", "creditsScene"),
    );
    onValue(getCreditsSceneRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        dispatch(initiateCreditsScene(data));
      }
    });
  }, [churchId, dispatch, firebaseDb, loginState]);

  const runObsTransition = useCallback(() => {
    if (isActive) {
      window.obsstudio?.setCurrentScene?.(transitionScene);
    }
  }, [transitionScene, isActive]);

  useEffect(() => {
    window.obsstudio?.getCurrentScene?.((scene) => {
      setIsActive(scene?.name === creditsScene);
    });
  }, [creditsScene]);

  return (
    <CreditsContainer
      credits={liveCredits}
      runObsTransition={runObsTransition}
    />
  );
};

export default Credits;
