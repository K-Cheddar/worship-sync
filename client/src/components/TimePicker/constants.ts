export const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
export const HOURS_24 = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0")
);
export const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0")
);
export const SECONDS = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0")
);

export const pad2 = (v: string | number) => String(v).padStart(2, "0");
