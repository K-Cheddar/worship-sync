import { useContext, useEffect } from "react";
import { default as CreditsContainer } from "../containers/Credits/Credits";
import { useDispatch, useSelector } from "../hooks";
import { initiatePublishedCreditsList } from "../store/creditsSlice";
import { onValue, ref } from "firebase/database";
import { GlobalInfoContext } from "../context/globalInfo";

const Credits = () => {
  const { publishedList } = useSelector(
    (state) => state.undoable.present.credits
  );
  const dispatch = useDispatch();
  const { user, firebaseDb } = useContext(GlobalInfoContext) || {};

  useEffect(() => {
    if (!firebaseDb || user === "Demo") return;

    const updateRef = ref(
      firebaseDb,
      "users/" + user + "/v2/published-credits"
    );
    onValue(updateRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        dispatch(initiatePublishedCreditsList(data));
      }
    });
  }, [dispatch, firebaseDb, user]);

  useEffect(() => {
    const duration = publishedList.length * 2;

    if (!publishedList.length) return;

    setTimeout(() => {
      window.obsstudio?.setCurrentScene("Welcome Screen 2");
    }, duration);
  }, [publishedList]);

  return <CreditsContainer credits={publishedList} />;
};

export default Credits;
