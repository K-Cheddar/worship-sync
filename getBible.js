import puppeteer from "puppeteer";

const book = "Genesis";

const bookMap = {
  Genesis: "Gen",
  Exodus: "Exod",
  Leviticus: "Lev",
  Numbers: "Num",
  Deuteronomy: "Deut",
  Joshua: "Josh",
  Judges: "Judg",
  Ruth: "Ruth",
  "1Samuel": "1Sam",
  "2Samuel": "2Sam",
  "1Kings": "1Kgs",
  "2Kings": "2Kgs",
  "1Chronicles": "1Chr",
  "2Chronicles": "2Chr",
  Ezra: "Ezra",
  Nehemiah: "Neh",
  Esther: "Esth",
  Job: "Job",
  Psalms: "Ps",
  Proverbs: "Prov",
  Ecclesiastes: "Eccl",
  "Songs of Solomon": "Song",
  Isaiah: "Isa",
  Jeremiah: "Jer",
  Lamentations: "Lam",
  Ezekiel: "Ezek",
  Daniel: "Dan",
  Hosea: "Hos",
  Joel: "Joel",
  Amos: "Amos",
  Obadiah: "Obad",
  Jonah: "Jonah",
  Micah: "Mic",
  Nahum: "Nah",
  Habakkuk: "Hab",
  Zephaniah: "Zeph",
  Haggai: "Hagg",
  Zechariah: "Zech",
  Malachi: "Mal",
  Matthew: "Matt",
  Mark: "Mark",
  Luke: "Luke",
  John: "John",
  Acts: "Acts",
  Romans: "Rom",
  "1Corinthians": "1Cor",
  "2Corinthians": "2Cor",
  Galatians: "Gal",
  Ephesians: "Eph",
  Philippians: "Phil",
  Colossians: "Col",
  "1Thessalonians": "1Thess",
  "2Thessalonians": "2Thess",
  "1Timothy": "1Tim",
  "2Timothy": "2Tim",
  Titus: "Titus",
  Philemon: "Phlm",
  Hebrews: "Heb",
  James: "Jas",
  "1Peter": "1Pet",
  "2Peter": "2Pet",
  "1John": "1John",
  "2John": "2John",
  "3John": "3John",
  Jude: "Jude",
  Revelation: "Rev",
};

const getVerses = async (book, chapter, version) => {
  try {
    const browser = await puppeteer.launch();

    const page = await browser.newPage();

    const url = `https://www.biblegateway.com/passage/?search=${book}%20${chapter}&version=${version}`;
    console.log(url);
    await page.goto(url);
    const data = await page.evaluate(
      (chapter, book, bookMap) => {
        const textArea = document.querySelector("div .passage-text");
        const headings = textArea.querySelectorAll("h1, h2, h3, h4, h5, h6");
        for (let i = 0; i < headings.length; ++i) {
          headings[i]?.remove();
        }
        const versesHtml = textArea.querySelectorAll(
          `span.text[class*="${bookMap[book]}-${chapter}-"`
        );

        const verses = [];
        let currentClass = "";
        let currentText = "";

        const addVerse = () => {
          // splitting by an invisible character, not a space
          const splitText = currentText.split(" ");
          verses.push({
            index: verses.length,
            name: (verses.length + 1).toString(), // verse number comes first
            text: splitText[1]
              .replace(/\[[^\]]{1,2}\]/g, "")
              .replaceAll(" ", " ")
              .replace("\n", "")
              .trim(),
          });
          currentText = "";
        };

        for (let i = 0; i < versesHtml.length; ++i) {
          const className = versesHtml[i].className;
          if (currentClass && className !== currentClass) {
            addVerse();
          }
          currentClass = className;
          currentText += versesHtml[i].innerText + " ";
        }
        addVerse();
        return verses;
      },
      chapter,
      book,
      bookMap
    );

    return {
      name: "1".toString(),
      index: 1 - 1,
      verses: data,
    };

    await browser.close();
  } catch (error) {
    console.error(error);
  }
};

export default getVerses;
