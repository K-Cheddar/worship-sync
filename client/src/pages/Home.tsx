import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import Button from "../components/Button/Button";
import { useContext } from "react";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import { GlobalInfoContext } from "../context/globalInfo";
import { ControllerInfoContext } from "../context/controllerInfo";

const HomeButton = ({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) => {
  return (
    <Button variant="tertiary" className="text-2xl" to={to} component="link">
      {children}
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
          padding="px-4 py-1"
          component={!isLoggedIn ? "link" : "button"}
          to={!isLoggedIn ? "/login" : "/"}
        >
          {!isLoggedIn ? "Login" : "Logout"}
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
            <HomeButton to="/controller">Main Controller</HomeButton>
            <HomeButton to="/credits-editor">Credits Editor</HomeButton>
          </section>
        </div>
        <div className="text-center bg-gray-700 rounded-md">
          <h3 className="text-lg border-b-4 border-black">
            Standalone Displays
          </h3>
          <section className="flex gap-4">
            <HomeButton to="/monitor">Monitor</HomeButton>
            <HomeButton to="/projector">Projector</HomeButton>
          </section>
        </div>
        <div className="text-center bg-gray-700 rounded-md">
          <h3 className="text-lg border-b-4 border-black">OBS Displays</h3>
          <section className="flex gap-4">
            <HomeButton to="/stream">Stream</HomeButton>
            <HomeButton to="/projector-full">Projector</HomeButton>
            <HomeButton to="/credits">Credits</HomeButton>
          </section>
        </div>
      </section>
    </main>
  );
};

export default Welcome;
