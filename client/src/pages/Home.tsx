import { Link } from "react-router-dom";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import Button from "../components/Button/Button";
import { ReactNode, useContext } from "react";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import { GlobalInfoContext } from "../context/globalInfo";

const LinkButton = ({ to, children }: { to: string; children: ReactNode }) => {
  return (
    <Button
      padding="p-0"
      className="text-2xl"
      variant={to === "/controller" ? "primary" : "tertiary"}
    >
      <Link className="h-full w-full px-4 py-2" to={to}>
        {children}
      </Link>
    </Button>
  );
};

const Welcome = () => {
  const { loginState, logout } = useContext(GlobalInfoContext) || {};
  const isLoggedIn = loginState === "success";
  return (
    <main className="bg-slate-700 h-screen w-screen text-white">
      <div className="flex w-full justify-end p-2 gap-4 text-lg">
        <Button
          variant="tertiary"
          onClick={isLoggedIn && logout ? logout : undefined}
        >
          {!isLoggedIn ? <Link to="/login">Login</Link> : "Logout"}
        </Button>
        <UserSection />
      </div>

      <img
        src={WorshipSyncImage}
        alt="WorshipSyncImage"
        className="max-w-[75%] mx-auto"
        width={400}
        height={367}
      />
      <p className="text-lg text-center w-full px-4">
        This software is in beta and works best with chromium based browsers
        like Edge and Chrome
      </p>
      <section className="flex flex-col mt-8 gap-4 bg-slate-800 w-full items-center p-8">
        <LinkButton to="/controller">Controller</LinkButton>
        <LinkButton to="/monitor">Monitor</LinkButton>
        <LinkButton to="/presentation">Presentation</LinkButton>
        <LinkButton to="/stream">Stream</LinkButton>
      </section>
    </main>
  );
};

export default Welcome;
