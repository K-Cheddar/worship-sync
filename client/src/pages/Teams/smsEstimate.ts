const GSM7_BASIC = new Set("@£$¥èéùìòÇØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""));
const GSM7_EXTENDED = new Set("^{}\\[~]|€".split(""));

export const measureMessage = (message: string) => {
  let units = 0;
  let gsm7 = true;
  for (const char of message) {
    if (GSM7_BASIC.has(char)) units += 1;
    else if (GSM7_EXTENDED.has(char)) units += 2;
    else { gsm7 = false; break; }
  }
  if (!gsm7) units = [...message].reduce((count, char) => count + char.length, 0);
  const single = gsm7 ? 160 : 70;
  const multi = gsm7 ? 153 : 67;
  return { characterCount: [...message].length, segmentCount: units <= single ? 1 : Math.ceil(units / multi) };
};
