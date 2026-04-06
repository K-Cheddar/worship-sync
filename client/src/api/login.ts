import { AccessType } from "../context/globalInfo";
import { getApiBasePath } from "../utils/environment";

type LoginResponse = {
  success: boolean;
  errorMessage: string;
  user?: {
    username: string;
    database: string;
    upload_preset: string;
    access?: AccessType;
  };
};

export const getStoredBoardAdminHeaders = (): Record<string, string> => {
  const loggedIn = localStorage.getItem("loggedIn") || "false";
  const username = localStorage.getItem("user") || "";
  const database = localStorage.getItem("database") || "";
  const access = localStorage.getItem("access") || "";

  return {
    "x-worshipsync-logged-in": loggedIn,
    "x-worshipsync-user": username,
    "x-worshipsync-database": database,
    "x-worshipsync-access": access,
  };
};

export const loginUser = async (
  username: string,
  password: string
): Promise<LoginResponse> => {
  try {
    const response = await fetch(
      `${getApiBasePath()}api/login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      }
    );

    const data = await response.json();

    return data as LoginResponse;
  } catch (error) {
    console.error("Login API error:", error);
    return {
      success: false,
      errorMessage: "Network error",
    };
  }
};
