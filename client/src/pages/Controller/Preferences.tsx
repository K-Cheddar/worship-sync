import Preferences from "../../containers/Preferences/Preferences";
import { PreferencesPageSkeleton } from "../../containers/Preferences/preferencesPageSkeletons";
import { useSelector } from "../../hooks";

const PreferencesPage = () => {
  const { isLoading } = useSelector(
    (state) => state.undoable.present.preferences
  );

  if (isLoading)
    return (
      <div className="scrollbar-variable flex h-full w-full flex-col items-center overflow-y-auto px-4 py-2">
        <h2 className="mb-4 text-center text-2xl font-semibold">Preferences</h2>
        <PreferencesPageSkeleton />
      </div>
    );

  return (
    <div className="scrollbar-variable px-4 py-2 overflow-y-auto">
      <h2 className="text-2xl font-semibold text-center mb-4">Preferences</h2>
      <Preferences />
    </div>
  );
};

export default PreferencesPage;
