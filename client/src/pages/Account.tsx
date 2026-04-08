import { useContext } from "react";
import Button from "../components/Button/Button";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import { GlobalInfoContext } from "../context/globalInfo";
import AccountManagement from "./Controller/Account";

const AccountPage = () => {
  const { loginState } = useContext(GlobalInfoContext) || {};
  const isLoggedIn = loginState === "success";

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-gray-700 text-white">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pb-6">
        <div className="flex w-full shrink-0 items-center justify-between gap-4 py-3 text-lg">
          <div className="flex flex-wrap items-center gap-2">
            <Button component="link" variant="tertiary" to="/">
              Home
            </Button>
          </div>
          <div className="flex flex-1 justify-end gap-4">
            {!isLoggedIn ? (
              <Button variant="tertiary" padding="px-4 py-1" component="link" to="/login">
                Sign in
              </Button>
            ) : null}
            <UserSection />
          </div>
        </div>

        <section className="mx-auto mt-4 flex w-full max-w-5xl shrink-0 flex-col gap-3 text-center">
          <h1 className="text-3xl font-semibold">Account management</h1>
          <p className="mx-auto max-w-3xl text-sm text-gray-200">
            Admins, trusted devices, recovery, and shared workstations—one place
            to manage it all.
          </p>
        </section>

        <section className="mx-auto mt-6 flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl border border-gray-500 bg-gray-800/60">
          <div className="scrollbar-variable min-h-0 flex-1 scroll-smooth overflow-y-auto p-3 sm:p-5">
            <AccountManagement />
          </div>
        </section>
      </div>
    </main>
  );
};

export default AccountPage;
