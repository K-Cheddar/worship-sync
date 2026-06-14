import { ReactNode, useContext } from "react";
import { ShieldAlert } from "lucide-react";
import Button from "./Button/Button";
import Icon from "./Icon/Icon";
import { GlobalInfoContext } from "../context/globalInfo";

const AdminOnly = ({ children }: { children: ReactNode }) => {
  const context = useContext(GlobalInfoContext);

  if (context?.role === "admin") {
    return <>{children}</>;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-homepage-canvas px-4 text-white">
      <section className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900/80 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-300/40 bg-amber-500/10 text-amber-200">
          <Icon svg={ShieldAlert} size="lg" className="text-amber-200" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold">Admin access required</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-200">
          You need admin access to manage teams, members, roles, services, and schedules.
        </p>
        <div className="mt-5 flex justify-center">
          <Button component="link" to="/home" variant="secondary">
            Back to home
          </Button>
        </div>
      </section>
    </main>
  );
};

export default AdminOnly;
