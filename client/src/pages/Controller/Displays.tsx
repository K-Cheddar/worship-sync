import DisplayOutputsPanel from "../../containers/TransmitHandler/DisplayOutputsPanel";

const DisplaysPage = () => (
  <div className="preferences-container scrollbar-variable flex h-full w-full flex-col items-center overflow-y-auto px-4 py-2">
    <h2 className="mb-4 text-center text-2xl font-semibold">Displays</h2>
    <DisplayOutputsPanel />
  </div>
);

export default DisplaysPage;
