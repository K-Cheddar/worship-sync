const longestCommonSubsequenceIds = (left: string[], right: string[]) => {
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i] === right[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const result = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.add(left[i]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
};

/** Place locally moved or added IDs relative to surviving anchors in the latest list. */
export function applyOrderedIdMoves(baseOrder: string[], desiredOrder: string[], latestIds: string[]) {
  const before = new Set(baseOrder);
  const after = new Set(desiredOrder);
  const retained = new Set(latestIds);
  const latestOrder = [...latestIds];
  const desiredExisting = desiredOrder.filter((id) => before.has(id));
  const baseKept = baseOrder.filter((id) => after.has(id));
  const stableIds = longestCommonSubsequenceIds(baseKept, desiredExisting);
  const localMovedOrAdded = new Set(
    desiredOrder.filter((id) => !before.has(id) || !stableIds.has(id)),
  );

  desiredOrder.forEach((id, index) => {
    if (!localMovedOrAdded.has(id) || !retained.has(id)) return;
    const existingIndex = latestOrder.indexOf(id);
    if (existingIndex >= 0) latestOrder.splice(existingIndex, 1);
    const nextAnchor = desiredOrder
      .slice(index + 1)
      .find((candidate) => latestOrder.includes(candidate));
    if (nextAnchor) {
      latestOrder.splice(latestOrder.indexOf(nextAnchor), 0, id);
      return;
    }
    const previousAnchor = desiredOrder
      .slice(0, index)
      .reverse()
      .find((candidate) => latestOrder.includes(candidate));
    if (previousAnchor) {
      latestOrder.splice(latestOrder.indexOf(previousAnchor) + 1, 0, id);
    } else {
      latestOrder.push(id);
    }
  });

  return latestOrder;
}
