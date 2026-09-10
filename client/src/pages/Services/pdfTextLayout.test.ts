import { reconstructPdfPageText } from "./pdfTextLayout";

describe("reconstructPdfPageText", () => {
  it("keeps same-row duration and title together and orders rows top-down", () => {
    const items = [
      { str: "4:00", transform: [1, 0, 0, 1, 10, 100] },
      { str: "Opening Song: Praise", transform: [1, 0, 0, 1, 60, 100] },
      { str: "15:00", transform: [1, 0, 0, 1, 10, 140] },
      { str: "SML", transform: [1, 0, 0, 1, 60, 140] },
    ];

    expect(reconstructPdfPageText(items)).toBe(
      "15:00 SML\n4:00 Opening Song: Praise",
    );
  });
});
