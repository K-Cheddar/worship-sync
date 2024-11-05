import { FormattedLyrics, SongOrder } from "../../types";
import generateRandomId from "../../utils/generateRandomId";
import { sortList, sortNamesInList } from "../../utils/sort";

type updateFormattedSectionsType = {
  formattedLyrics: FormattedLyrics[];
  songOrder: SongOrder[];
};

export const updateFormattedSections = ({
  formattedLyrics: _formattedLyrics,
  songOrder: _songOrder,
}: updateFormattedSectionsType) => {
  const formattedLyrics = [..._formattedLyrics];
  let songOrder = _songOrder.length > 0 ? [..._songOrder] : [];

  let sections: string[] = [];
  let sectionUpdates: any = {};
  let sectionCounter: any = {};

  for (let i = 0; i < formattedLyrics.length; i++) {
    if (formattedLyrics[i].type in sectionCounter) {
      sectionCounter[formattedLyrics[i].type] += 1;
      sectionCounter[formattedLyrics[i].type + "_counter"] += 1;
    } else {
      sectionCounter[formattedLyrics[i].type] = 1;
      sectionCounter[formattedLyrics[i].type + "_counter"] = 0;
    }
  }

  for (let i = 0; i < formattedLyrics.length; i++) {
    let type = formattedLyrics[i].type;
    let max = sectionCounter[type];
    let counter = sectionCounter[type + "_counter"];
    let name;

    if (max === 1) {
      name = type;
    } else {
      name = type + " " + (max - counter);
      sectionCounter[type + "_counter"] -= 1;
    }

    sectionUpdates[formattedLyrics[i].name] = {
      newName: name,
      changed: formattedLyrics[i].name !== name,
    };
    const copiedLyric = { ...formattedLyrics[i] };
    copiedLyric.name = name;
    formattedLyrics[i] = copiedLyric;
    sections.push(name);
  }

  for (let i = 0; i < songOrder.length; i++) {
    let section = songOrder[i];
    if (sectionUpdates[section.name] && sectionUpdates[section.name].changed) {
      const songOrderObj = { ...songOrder[i] };
      songOrderObj.name = sectionUpdates[section.name].newName;
      songOrder[i] = songOrderObj;
    }
  }

  if (songOrder.length === 0) {
    songOrder = sections.map((section) => {
      return {
        name: section,
        id: generateRandomId(),
      };
    });
  }

  const sortedFormattedLyrics = sortNamesInList(formattedLyrics);

  return {
    formattedLyrics: sortedFormattedLyrics,
    songOrder,
  };
};
