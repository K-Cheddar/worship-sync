import Preferences from "../../containers/Preferences/Preferences";
import { useSelector } from "../../hooks";
import Spinner from "../../components/Spinner/Spinner";
import Button from "../../components/Button/Button";

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

  return (
    <div className="scrollbar-variable px-4 py-2 overflow-y-auto">
      <h2 className="text-2xl font-semibold text-center mb-4">Preferences</h2>
      <div className="mb-4 flex justify-center">
        <Button component="link" to="/account" variant="tertiary">
          Manage account
        </Button>
      </div>
      <Preferences />
    </div>
  );
};

export default PreferencesPage;
