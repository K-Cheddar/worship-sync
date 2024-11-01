type getVersesType = {
  book: string;
  chapter: number;
  version: string;
};

export const getVerses = async ({ book, chapter, version }: getVersesType) => {
  let data = null;

  try {
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_PATH}api/bible/?book=${book}&chapter=${
        chapter + 1
      }&version=${version}`.replaceAll(" ", "")
    );
    data = await response.json();
  } catch (error) {
    console.error(error);
  }

  return data;
};
