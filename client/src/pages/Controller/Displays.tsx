import { Link } from "react-router-dom";
import DisplayOutputsPanel from "../../containers/TransmitHandler/DisplayOutputsPanel";

const DisplaysPage = () => (
  <div className="preferences-container scrollbar-variable flex h-full w-full flex-col items-center overflow-y-auto px-4 py-2">
    <h2 className="mb-4 text-center text-2xl font-semibold">Displays</h2>
    <DisplayOutputsPanel />
    {/* Controllers decide which of these screens each operator surface owns,
        which is church setup rather than something changed mid-service — so it
        lives under the account. A pointer, because this is where an operator
        looking for it would start. */}
    <p className="mt-6 max-w-4xl text-center text-sm text-gray-400">
      Giving a display to another operator surface is set up under{" "}
      <Link
        to="/account/controllers"
        className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
      >
        Controllers
      </Link>
      .
    </p>
  </div>
);

export default DisplaysPage;
