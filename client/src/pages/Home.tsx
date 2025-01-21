import { Link } from "react-router-dom";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import Button from "../components/Button/Button";
import { ReactNode, useContext } from "react";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import { GlobalInfoContext } from "../context/globalInfo";
import { ControllerInfoContext } from "../context/controllerInfo";
import cn from "classnames";

type LinkButtonProps = {
  to: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "tertiary" | "cta" | "none";
  className?: string;
};
const LinkButton = ({
  to,
  children,
  variant = "tertiary",
  className,
}: LinkButtonProps) => {
  return (
    <Button
      padding="p-0"
      className={cn("text-2xl", className)}
      variant={variant}
    >
      <Link className="h-full w-full px-4 py-2" to={to}>
        {children}
      </Link>
    </Button>
  );
};

const Welcome = () => {
  const { loginState } = useContext(GlobalInfoContext) || {};
  const { logout } = useContext(ControllerInfoContext) || {};
  const isLoggedIn = loginState === "success";
  return (
    <main className="bg-gray-700 h-screen text-white">
      <div className="flex w-full justify-end p-2 gap-4 text-lg">
        <Button
          variant="tertiary"
          onClick={isLoggedIn && logout ? logout : undefined}
          padding={`${isLoggedIn ? "px-4 py-1" : "p-0"}`}
        >
          {!isLoggedIn ? (
            <Link className="h-full w-full px-4 py-1" to="/login">
              Login
            </Link>
          ) : (
            "Logout"
          )}
        </Button>
        <UserSection />
      </div>

      <img
        src={WorshipSyncImage}
        alt="WorshipSyncImage"
        className="max-w-[75%] mx-auto"
        width={400}
        height={367}
        loading="eager"
      />
      <p className="text-lg text-center w-full px-4">
        This software is in beta and works best with chromium based browsers
        like Edge and Chrome. Some features are built to work within OBS.
      </p>
      <section className="flex flex-col mt-8 gap-4 bg-gray-800 w-full items-center p-8">
        <div className="text-center">
          <h3 className="text-lg border-b-4 border-black">Editors</h3>
          <section className="flex gap-4">
            <LinkButton to="/controller">Main Controller</LinkButton>
            <LinkButton to="/credits-editor">Credits Editor</LinkButton>
          </section>
        </div>
        <div className="text-center bg-gray-700 rounded-md">
          <h3 className="text-lg border-b-4 border-black">
            Standalone Displays
          </h3>
          <section className="flex gap-4">
            <LinkButton to="/monitor">Monitor</LinkButton>
            <LinkButton to="/projector">Projector</LinkButton>
          </section>
        </div>
        <div className="text-center bg-gray-700 rounded-md">
          <h3 className="text-lg border-b-4 border-black">OBS Displays</h3>
          <section className="flex gap-4">
            <LinkButton to="/stream">Stream</LinkButton>
            <LinkButton to="/projector-full">Projector</LinkButton>
            <LinkButton to="/credits">Credits</LinkButton>
          </section>
        </div>
      </section>
    </main>
  );
};

export default Welcome;
