import { getApiBasePath } from "../utils/environment";

type getBiblesType = {
  version: string;
};

export const getBibles = async ({ version }: getBiblesType) => {
  let data = null;

  try {
    const response = await fetch(
      `${getApiBasePath()}bible/?version=${version}`
    );
    data = await response.json();
  } catch (error) {
    console.error(error);
  }

  return data;
};
