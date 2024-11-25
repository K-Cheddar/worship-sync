import { Link } from "react-router-dom";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import Button from "../components/Button/Button";
import { ReactNode } from "react";

const LinkButton = ({ to, children }: { to: string; children: ReactNode }) => {
  return (
    <Button
      padding="p-0"
      variant={to === "/controller" ? "primary" : "tertiary"}
    >
      <Link className="h-full w-full px-4 py-2" to={to}>
        {children}
      </Link>
    </Button>
  );
};

const Welcome = () => {
  return (
    <main className="bg-slate-700 h-screen w-screen text-white">
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
      <section className="flex flex-col text-2xl mt-8 gap-4 bg-slate-800 w-full items-center p-8">
        <LinkButton to="/controller">Controller</LinkButton>
        <LinkButton to="/monitor">Monitor</LinkButton>
        <LinkButton to="/presentation">Presentation</LinkButton>
        <LinkButton to="/stream">Stream</LinkButton>
      </section>
    </main>
  );
};

export default Welcome;
