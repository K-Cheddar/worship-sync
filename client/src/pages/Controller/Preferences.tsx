import Preferences from "../../containers/Preferences/Preferences";
import { useSelector } from "../../hooks";
import Spinner from "../../components/Spinner/Spinner";
import Button from "../../components/Button/Button";
import { useDispatch } from "react-redux";
import { setTab } from "../../store/preferencesSlice";
import QuickLinks from "../../containers/Preferences/QuickLinks";
import "./Controller.scss";

const PreferencesPage = () => {
  const dispatch = useDispatch();
  const { isLoading, tab } = useSelector(
    (state) => state.undoable.present.preferences
  );

  if (isLoading)
    return (
      <div className="flex flex-col gap-4 h-full w-full items-center justify-center">
        <p className="text-xl font-semibold">Loading preferences...</p>
        <Spinner />
      </div>
    );

  return (
    <div className="preferences-container">
      <h2 className="text-2xl font-semibold text-center mb-4">Preferences</h2>
      <section className="flex justify-center border border-gray-400 my-4 rounded-l-md rounded-r-md">
        <Button
          variant={tab === "defaults" ? "secondary" : "tertiary"}
          onClick={() => dispatch(setTab("defaults"))}
          className="justify-center rounded-r-none flex-1"
        >
          Defaults
        </Button>
        <Button
          variant={tab === "quickLinks" ? "secondary" : "tertiary"}
          onClick={() => dispatch(setTab("quickLinks"))}
          className="justify-center rounded-l-none flex-1"
        >
          Quick Links
        </Button>
      </section>
      {tab === "defaults" && <Preferences />}
      {tab === "quickLinks" && <QuickLinks />}
    </div>
  );
};

export default PreferencesPage;
