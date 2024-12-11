import fs from "node:fs";

const hymns = fs.readdirSync("./hymns");
const formattedHymns = [];

const generateRandomId = () => {
  const dateString = Date.now().toString(32);
  const randomNumber = Math.random().toString(32).substring(2);
  return dateString + randomNumber;
};

for (const hymn of hymns) {
  const data = fs.readFileSync(`./hymns/${hymn}`);
  const parsedHymn = JSON.parse(data);
  const { formattedSections, title } = parsedHymn;
  const songOrder = [];
  const refrain = formattedSections.find(
    (section) => section.heading === "Refrain"
  );
  const sectionsWithoutRefrain = formattedSections.filter(
    (section) => section.heading !== "Refrain"
  );

  for (let i = 0; i < sectionsWithoutRefrain.length; i++) {
    const section = sectionsWithoutRefrain[i];
    songOrder.push({ name: section.heading, id: generateRandomId() });
    if (refrain) {
      songOrder.push({ name: "Refrain", id: generateRandomId() });
    }
  }

  const formattedLyrics = formattedSections.map(({ content, heading }) => ({
    type: heading.split(" ")[0],
    name: heading,
    words: content,
    id: generateRandomId(),
    slideSpan: 1,
  }));

  const formattedHymn = {
    name: title,
    formattedLyrics,
    songOrder,
  };

  formattedHymns.push(formattedHymn);
}

fs.writeFile(
  `./hymns/master.json`,
  JSON.stringify(formattedHymns),
  function (err) {
    if (err) {
      return console.log(err);
    }
    console.log(`Saved formattedHymns`);
  }
);
