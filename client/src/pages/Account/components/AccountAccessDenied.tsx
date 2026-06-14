import { ShieldPlus } from "lucide-react";
import Button from "../../../components/Button/Button";
import { useAccountPage } from "../AccountPageContext";

const AccountAccessDenied = () => {
  const { canRequestRecovery, churchId, runAction, showStatus, requestAdminAccess } =
    useAccountPage();

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-gray-700 bg-gray-950/50 p-6 text-center">
      <h2 className="text-2xl font-semibold">Account</h2>
      <p className="mt-3 text-sm leading-relaxed text-gray-200">
        {canRequestRecovery
          ? "Add an admin before you can manage settings here."
          : "You need admin access to manage this church."}
      </p>
      {canRequestRecovery ? (
        <div className="mt-6">
          <Button
            variant="cta"
            svg={ShieldPlus}
            onClick={() =>
              void runAction(async () => {
                await requestAdminAccess(churchId);
                showStatus("Admin recovery request sent.");
              })
            }
          >
            Request admin access
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default AccountAccessDenied;
