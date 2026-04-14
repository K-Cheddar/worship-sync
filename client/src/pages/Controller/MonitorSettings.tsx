import MonitorSettings from "../../containers/Preferences/MonitorSettings";
import { MonitorSettingsPageSkeleton } from "../../containers/Preferences/preferencesPageSkeletons";
import { useSelector } from "../../hooks";

const MonitorSettingsPage = () => {
  const { isLoading } = useSelector(
    (state) => state.undoable.present.preferences
  );

  if (isLoading)
    return (
      <div className="preferences-container scrollbar-variable flex h-full w-full flex-col items-center overflow-y-auto px-4 py-2">
        <h2 className="mb-4 text-center text-2xl font-semibold">
          Monitor Settings
        </h2>
        <MonitorSettingsPageSkeleton />
      </div>
    );

  return (
    <div className="preferences-container">
      <h2 className="text-2xl font-semibold text-center mb-4">
        Monitor Settings
      </h2>
      <MonitorSettings />
    </div>
  );
};

export default MonitorSettingsPage;
