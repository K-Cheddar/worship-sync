const GSM7_EXTENDED_AND_LATIN_CHARS =
  "\u00c4\u00d6\u00d1\u00dc\u00a7\u00bf\u00e4\u00f6\u00f1\u00fc\u00e0\u20ac";

const isGsm7Text = (value) =>
  [...String(value || "")].every(
    (character) =>
      character.charCodeAt(0) <= 127 ||
      GSM7_EXTENDED_AND_LATIN_CHARS.includes(character),
  );

export const measureSmsMessage = (body) => {
  const text = String(body || "");
  const gsm7 = isGsm7Text(text);
  const singleSegmentLimit = gsm7 ? 160 : 70;
  const concatenatedSegmentLimit = gsm7 ? 153 : 67;
  const segmentCount =
    text.length <= singleSegmentLimit
      ? 1
      : Math.ceil(text.length / concatenatedSegmentLimit);
  return {
    characterCount: text.length,
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
