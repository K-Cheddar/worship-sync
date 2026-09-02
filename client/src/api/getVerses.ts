import { verseType } from "../types";
import { bookMap } from "./bookMap";
import { getApiBasePath } from "../utils/environment";

type getVersesType = {
  book: string;
  chapter: number;
  version: string;
};

export const getVerses = async ({ book, chapter, version }: getVersesType) => {
  let data = null;

  const _chapter = chapter + 1;

  try {
    const response = await fetch(
      `${getApiBasePath()}api/bible/?book=${book}&chapter=${_chapter}&version=${version}`.replaceAll(
        " ",
        ""
      )
    );

    const text = await response.text();
    data = await parseData(text, _chapter, book);
  } catch (error) {
    console.error(error);
  }

  return data;
};

const parseData = async (textHtml: string, chapter: number, book: string) => {
  const el = document.createElement("html");
  el.innerHTML = textHtml;

  const textArea = el.querySelector("div .passage-text");

  const unwantedText =
    textArea?.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, .crossreference, .footnote"
    ) || [];
  for (let i = 0; i < unwantedText.length; ++i) {
    unwantedText[i]?.remove();
  }

  const versesHtml = textArea?.querySelectorAll(
    `span.text[class*="${bookMap[book as keyof typeof bookMap]}-${chapter}-"]`,
  );

  const verses: verseType[] = [];
  let currentClass = "";
  let currentText = "";

  const addVerse = () => {
    verses.push({
      index: verses.length,
      name: (verses.length + 1).toString(), // verse number comes first
      text: currentText
        .replace(/\[[^\]]{1,2}\]/g, "")
        .replaceAll(" ", " ") // Replace non-breaking spaces
        .replaceAll("’", "'") // Replace curly apostrophe
        .replaceAll("‘", "'") // Replace curly apostrophe
        .replace(/\s+/g, " ")
        .trim(),
    });
    currentText = "";
  };

  if (!versesHtml || versesHtml.length === 0) {
    return {
      name: "1".toString(),
      index: 1 - 1,
      verses,
    };
  }

  for (let i = 0; i < versesHtml.length; ++i) {
    const className = versesHtml[i].className;
    if (currentClass && className !== currentClass) {
      addVerse();
    }
    currentClass = className;
    const verseElement = versesHtml[i].cloneNode(true) as HTMLElement;
    verseElement
      .querySelectorAll(".chapternum, .versenum, .footnote")
      .forEach((element) => element.remove());
    currentText += verseElement.textContent + " ";
  }
  addVerse();

  return {
    name: "1".toString(),
    index: 1 - 1,
    verses,
  };
};
