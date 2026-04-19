import type { CSSProperties } from "react";
import { useContext, useMemo } from "react";
import { House, LogIn } from "lucide-react";
import Button from "../components/Button/Button";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import { GlobalInfoContext } from "../context/globalInfo";
import { ChurchLogoImg } from "../components/ChurchLogoImg";
import { resolveChurchToolbarLogoUrl } from "../utils/churchBranding";
import { useSelector } from "../hooks";
import type { RootState } from "../store/store";
import AccountManagement from "./Controller/Account";

const AccountPage = () => {
  const scrollbarWidth = useSelector(
    (state: RootState) => state.undoable.present.preferences.scrollbarWidth,
  );
  const { loginState, churchBranding, churchName } =
    useContext(GlobalInfoContext) || {};
  const isLoggedIn = loginState === "success";
  const toolbarLogoUrl = useMemo(
    () => resolveChurchToolbarLogoUrl(churchBranding),
    [churchBranding],
  );
  const churchNameTrimmed = churchName?.trim() ?? "";

  return (
    <main
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-homepage-canvas text-white"
      style={
        {
          "--scrollbar-width": scrollbarWidth,
        } as CSSProperties
      }
    >
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pb-6">
        <div className="grid w-full shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-gray-700 py-3 text-lg">
          <div className="flex flex-wrap items-center gap-2 justify-self-start">
            <Button
              component="link"
              variant="tertiary"
              svg={House}
              iconSize="sm"
              to="/"
            >
              Home
            </Button>
          </div>
          <div className="flex max-w-[min(22rem,calc(100vw-6rem))] justify-center justify-self-center px-1 sm:max-w-[min(26rem,calc(100vw-10rem))]">
            {toolbarLogoUrl ? (
              <ChurchLogoImg
                src={toolbarLogoUrl}
                alt={churchNameTrimmed ? `${churchNameTrimmed} logo` : "Church logo"}
                variant="account-header"
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end justify-self-end gap-4">
            {!isLoggedIn ? (
              <Button
                variant="tertiary"
                svg={LogIn}
                iconSize="sm"
                padding="px-4 py-1"
                component="link"
                to="/login"
              >
                Sign in
              </Button>
            ) : null}
            <UserSection />
          </div>
        </div>

        <section className="mx-auto mt-4 flex w-full max-w-5xl shrink-0 flex-col gap-3 text-center">
          <h1 className="text-3xl font-semibold">Church administration</h1>
          <p className="mx-auto max-w-3xl text-sm text-gray-200">
            Invite people, manage access, pair workstations and displays, handle
            recovery and trusted devices, and set branding—all in one place for
            this church.
          </p>
        </section>

        <section className="mx-auto mt-6 flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900/40">
          <div className="scrollbar-variable min-h-0 flex-1 scroll-smooth overflow-y-auto p-3 sm:p-5">
            <AccountManagement />
          </div>
        </section>
      </div>
    </main>
  );
};

export default AccountPage;
