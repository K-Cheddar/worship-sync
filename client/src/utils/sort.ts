export const sortNamesInList = (list: any[]) => {
  if (!list) return list;
  try {
    return [...list].sort((a, b) => {
      let nameA = a.name.toUpperCase();
      let nameB = b.name.toUpperCase();
      return nameA.localeCompare(nameB, "en", { numeric: true });
    });
  } catch (err) {
    console.error(err);
    return list;
  }
};

export const sortList = (list: any[]) => {
  try {
    return [...list].sort((a, b) => {
      let nameA = a.toUpperCase();
      let nameB = b.toUpperCase();
      return nameA.localeCompare(nameB, "en", { numeric: true });
    });
  } catch (err) {
    console.error(err);
    return list;
  }
};
