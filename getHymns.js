import { JSDOM } from "jsdom";
import fs from "node:fs";

const numbersArray = Array.from({ length: 1 }, (_, i) =>
  (i + 1).toString().padStart(3, "0")
);
// const numbersArray = Array.from({ length: 698 }, (_, i) =>
//   (i + 1).toString().padStart(3, "0")
// );
numbersArray.sort(() => 0.5 - Math.random());

const completedHymns = fs.readdirSync("./hymns");
const completedNumbers = completedHymns.map((hymn) =>
  hymn.split("–")[0].trim()
);

const updatedNumbersArray = numbersArray.filter(
  (num) => !completedNumbers.includes(num)
);

console.log(
  "Completed Hymns: ",
  completedNumbers.length,
  "Still needed: ",
  updatedNumbersArray.length
);

(async () => {
  for await (const [index, num] of updatedNumbersArray.entries()) {
    if (completedNumbers.includes(num)) {
      continue;
    }
    let hymn = num;
    if (num === "002") {
      hymn = "002-all-creatures-of-our-god-and-king/";
    }
    const data = await fetch(`https://sdahymnals.com/Hymnal/${hymn}`);
    const html = await data.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const title = document.querySelector(
      'h1.title[itemprop="headline"]'
    ).textContent;
    const textArea = document.querySelector(
      "div#content_box div.single_post table td"
    );
    const sections = textArea.querySelectorAll("p");
    const formattedSections = [];
    for (let i = 0; i < sections.length; ++i) {
      const section = sections[i].textContent;
      const lines = section.split("\n");
      const [heading, ...content] = lines;
      const formattedSection = {
        content: content.join("\n"),
      };
      if (isNaN(heading)) {
        // this is a refrain
        formattedSection.heading = heading;
      } else {
        // this is a verse
        formattedSection.heading = "Verse " + heading;
      }
      formattedSections.push(formattedSection);
    }
    const song = {
      title,
      formattedSections,
    };
    fs.writeFile(`./hymns/${title}.json`, JSON.stringify(song), function (err) {
      if (err) {
        return console.log(err);
      }
      console.log(
        `Saved hymn. Progress: ${index + 1} / ${
          updatedNumbersArray.length
        } || Title: ${title}`
      );
    });
    const randomMs = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000;
    await new Promise((resolve) => setTimeout(resolve, randomMs));
  }
})();
