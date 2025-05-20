import Preferences from "../../containers/Preferences/Preferences";
import { useSelector } from "../../hooks";
import Spinner from "../../components/Spinner/Spinner";

const PreferencesPage = () => {
  const { isLoading } = useSelector(
    (state) => state.undoable.present.preferences
  );

  if (isLoading)
    return (
      <div className="flex flex-col gap-4 h-full w-full items-center justify-center">
        <p className="text-xl font-semibold">Loading preferences...</p>
        <Spinner />
      </div>
    );

  return <Preferences />;
};

export default PreferencesPage;
