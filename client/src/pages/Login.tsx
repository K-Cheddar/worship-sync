import Input from "../components/Input/Input";
import { useContext, useState } from "react";
import { GlobalInfoContext } from "../context/globalInfo";
import Button from "../components/Button/Button";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const { login } = useContext(GlobalInfoContext) || {};

  return (
    <div className="h-screen w-screen bg-slate-700 flex items-center justify-center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!login) return;
          login({ username, password });
        }}
        className="bg-slate-800 rounded-xl w-[500px] max-w-[75%] p-8 text-white flex flex-col items-center"
      >
        <h1 className="text-2xl font-semibold text-center">Login</h1>
        <Input
          label="Username"
          value={username}
          onChange={(val) => setUsername(val as string)}
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(val) => setPassword(val as string)}
        />
        <Button
          disabled={!username || !password}
          variant="cta"
          className="text-lg mt-4"
          padding="px-8 py-2"
          onClick={() => {
            if (!login) return;
            login({ username, password });
          }}
        >
          Login
        </Button>
      </form>
    </div>
  );
};

export default Login;
