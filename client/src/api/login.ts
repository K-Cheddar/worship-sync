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
