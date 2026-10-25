import { render, screen } from "@testing-library/react";
import HighlightWords from "./HighlightWords";

it("highlights retrieved typos and prefixes at any text position, without short-word fuzziness", () => {
  const { rerender } = render(
    <HighlightWords
      string="my shepherd in a quiet valley"
      searchValue="sheperd val"
    />,
  );
  expect(screen.getByText("shepherd")).toHaveClass("font-medium");
  expect(screen.getByText("valley")).toHaveClass("font-medium");
  expect(screen.getByText("quiet")).not.toHaveClass("font-medium");
  rerender(<HighlightWords string="cat shepherd" searchValue="bat" />);
  expect(screen.getByText("cat")).not.toHaveClass("font-medium");
  expect(screen.getByText("shepherd")).not.toHaveClass("font-medium");
});

it("updates highlights with the query and preserves lyric line breaks", () => {
  const { rerender } = render(
    <HighlightWords
      string={"quiet valley\n\njoyful ocean"}
      searchValue="valley"
      preserveLineBreaks
    />,
  );
  expect(screen.getByRole("paragraph")).toHaveClass("whitespace-pre-wrap");
  expect(screen.getByRole("paragraph").textContent).toBe(
    "quiet valley\n\njoyful ocean",
  );
  expect(screen.getByText("valley")).toHaveClass("font-semibold");
  rerender(
    <HighlightWords
      string={"quiet valley\n\njoyful ocean"}
      searchValue="ocean"
      preserveLineBreaks
    />,
  );
  expect(screen.getByText("valley")).not.toHaveClass("font-semibold");
  expect(screen.getByText("ocean")).toHaveClass("font-semibold");
});

it("highlights only the contributing token in punctuation-separated text", () => {
  render(<HighlightWords string="quiet-valley" searchValue="val" />);
  expect(screen.getByText("valley")).toHaveClass("font-medium");
  expect(screen.getByText("quiet-")).not.toHaveClass("font-medium");
});
