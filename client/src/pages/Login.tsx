import Input from "../components/Input/Input";
import { useContext, useEffect, useState } from "react";
import { GlobalInfoContext } from "../context/globalInfo";
import { ReactComponent as VisibleSVG } from "../assets/icons/visible.svg";
import { ReactComponent as NotVisibleSVG } from "../assets/icons/not-visible.svg";
import Button from "../components/Button/Button";
import { useNavigate } from "react-router-dom";
import { ControllerInfoContext } from "../context/controllerInfo";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasError, setHasError] = useState(false);

  const navigate = useNavigate();

  const { loginState, setLoginState } = useContext(GlobalInfoContext) || {};

  const { login } = useContext(ControllerInfoContext) || {};

  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (loginState === "error") {
      setHasError(true);
    }
  }, [loginState]);

  useEffect(() => {
    if (loginState === "success") navigate("/");
    return () => {
      setShowPassword(false);
      setUsername("");
      setPassword("");
      setHasError(false);
    };
  }, [setLoginState, loginState, navigate]);

  return (
    <div className="h-screen w-screen bg-slate-700 flex items-center justify-center">
      <form
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          login?.({ username, password });
        }}
        className="bg-slate-800 rounded-xl w-[300px] max-w-[75%] p-8 text-white flex flex-col items-center"
      >
        <h1 className="text-2xl font-semibold text-center">Login</h1>
        <Input
          label="Username"
          id="username"
          value={username}
          onChange={(val) => setUsername(val as string)}
          className="w-full"
        />
        <Input
          label="Password"
          id="password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(val) => setPassword(val as string)}
          svg={showPassword ? NotVisibleSVG : VisibleSVG}
          svgAction={() => setShowPassword(!showPassword)}
          svgPadding="px-1 py-4"
          className="w-full"
        />
        <Button
          variant="cta"
          type={"submit"}
          className="text-lg mt-4 w-full justify-center"
          isLoading={loginState === "loading"}
          disabled={loginState === "loading"}
          onClick={() => {
            if (!login) return;
            login({ username, password });
          }}
        >
          Login
        </Button>
        <Button
          className="text-lg mt-4 w-full justify-center"
          onClick={() => navigate("/")}
        >
          Home
        </Button>
        {hasError && (
          <p className="text-red-500 mt-4 text-base">
            Invalid username or password
          </p>
        )}
      </form>
    </div>
  );
};

export default Login;
