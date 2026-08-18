import ControllerProfilesPanel from "../../../containers/TransmitHandler/ControllerProfilesPanel";

/**
 * Controllers live under the church account, not inside the presentation
 * controller.
 *
 * Deciding that a second operator surface exists and which screens it owns is
 * church setup, on a par with pairing displays — not something the presentation
 * operator changes mid-service. Configuring it from inside the very controller
 * it takes displays away from also read as backwards.
 */
const AccountControllersPage = () => (
  <div className="flex w-full flex-col items-center">
    <ControllerProfilesPanel />
  </div>
);

export default AccountControllersPage;
