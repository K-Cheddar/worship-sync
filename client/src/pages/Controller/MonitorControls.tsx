import WindowControls from "../../containers/Toolbar/ToolbarElements/WindowControls";

const MonitorControlsPage = () => {
  return (
    <div className="scrollbar-variable px-4 py-2 overflow-y-auto">
      <h2 className="text-2xl font-semibold text-center mb-4">Monitor Controls</h2>
      <WindowControls />
    </div>
  );
};

export default MonitorControlsPage;
