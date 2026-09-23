const GSM7_BASIC_CHARS = new Set(
  "@\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\u00d8\u00f8\r\u00c5\u00e5\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e\u001b\u00c6\u00e6\u00df\u00c9 !\"#\u00a4%&'()*+,-./0123456789:;<=>?\u00a1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c4\u00d6\u00d1\u00dc\u00a7\u00bfabcdefghijklmnopqrstuvwxyz\u00e4\u00f6\u00f1\u00fc\u00e0".split(""),
);
const GSM7_EXTENDED_CHARS = new Set([
  "^",
  "{",
  "}",
  "\\",
  "[",
  "~",
  "]",
  "|",
  "\u20ac",
]);

const gsm7UnitCount = (text) => {
  let unitCount = 0;
  for (const character of text) {
    if (GSM7_BASIC_CHARS.has(character)) {
      unitCount += 1;
    } else if (GSM7_EXTENDED_CHARS.has(character)) {
      unitCount += 2;
    } else {
      return null;
    }
  }
  return unitCount;
};

export const measureSmsMessage = (body) => {
  const text = String(body || "");
  const gsm7Units = gsm7UnitCount(text);
  const gsm7 = gsm7Units !== null;
  const unitCount = gsm7
    ? gsm7Units
    : [...text].reduce(
        (count, character) => count + (character.length === 2 ? 2 : 1),
        0,
      );
  const singleSegmentLimit = gsm7 ? 160 : 70;
  const concatenatedSegmentLimit = gsm7 ? 153 : 67;
  const segmentCount =
    unitCount <= singleSegmentLimit
      ? 1
      : Math.ceil(unitCount / concatenatedSegmentLimit);
  return {
    characterCount: [...text].length,
    unitCount,
    segmentCount,
    encoding: gsm7 ? "gsm7" : "ucs2",
  };
};

export const buildTeamIntakeSms = ({ churchName, formName, publicUrl }) => {
  const safeChurchName =
    String(churchName || "WorshipSync").trim() || "WorshipSync";
  const safeFormName =
    String(formName || "availability").trim() || "availability";
  const safePublicUrl = String(publicUrl || "").trim();
  if (!safePublicUrl) throw new Error("An intake URL is required for SMS.");
  const body = `${safeChurchName}: Please submit your ${safeFormName} availability: ${safePublicUrl} Reply STOP to opt out.`;
  return { body, ...measureSmsMessage(body) };
};
