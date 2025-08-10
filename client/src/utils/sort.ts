export const sortNamesInList = (list: any[]) => {
  if (!list) return list;
  try {
    return [...list].sort((a, b) => {
      const nameA = a.name.toUpperCase();
      const nameB = b.name.toUpperCase();
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
      const nameA = a.toUpperCase();
      const nameB = b.toUpperCase();
      return nameA.localeCompare(nameB, "en", { numeric: true });
    });
  } catch (err) {
    console.error(err);
    return list;
  }
};
