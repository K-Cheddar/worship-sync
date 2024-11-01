type getBiblesType = {
  version: string;
};

export const getBibles = async ({ version }: getBiblesType) => {
  let data = null;

  try {
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_PATH}bible/?version=${version}`
    );
    data = await response.json();
  } catch (error) {
    console.error(error);
  }

  return data;
};
