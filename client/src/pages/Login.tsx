import Input from "../components/Input/Input";
import { useContext, useEffect, useState } from "react";
import { GlobalInfoContext } from "../context/globalInfo";
import { Eye } from "lucide-react";
import { EyeOff } from "lucide-react";
import Button from "../components/Button/Button";
import { useNavigate } from "react-router-dom";
import { ControllerInfoContext } from "../context/controllerInfo";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const navigate = useNavigate();

  const { loginState, setLoginState } = useContext(GlobalInfoContext) || {};

  const { login } = useContext(ControllerInfoContext) || {};

  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (loginState === "error") {
      setErrorMessage("Invalid username or password");
    }
  }, [loginState]);

  useEffect(() => {
    if (loginState === "success") navigate("/");
    return () => {
      setShowPassword(false);
      setUsername("");
      setPassword("");
      setErrorMessage("");
    };
  }, [setLoginState, loginState, navigate]);

  const handleLogin = () => {
    if (!username || !password) {
      setErrorMessage("Username and password are required");
      return;
    }
    login?.({ username, password });
  };

  return (
    <div className="h-dvh w-dvw bg-gray-700 flex items-center justify-center">
      <form
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          handleLogin();
        }}
        className="bg-gray-800 rounded-xl w-[300px] max-w-[75%] p-8 text-white flex flex-col items-center"
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
          svg={showPassword ? EyeOff : Eye}
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
        >
          Login
        </Button>
        <Button
          className="text-lg mt-4 w-full justify-center"
          onClick={() => navigate("/")}
        >
          Home
        </Button>
        {errorMessage && (
          <p className="text-red-500 mt-4 text-base">{errorMessage}</p>
        )}
      </form>
    </div>
  );
};

export default Login;
