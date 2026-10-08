import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import DocxPreview from "./DocxPreview";

it("renders a real Word document with formatting and tables in an isolated scroll stage", async () => {
  const bytes = Uint8Array.from(readFileSync(join(__dirname, "__fixtures__/formatted.docx")));
  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer } as Response);
  const onReady = jest.fn();
  const onError = jest.fn();
  const view = render(<DocxPreview url="https://r2.example.test/signed" onReady={onReady} onError={onError} />);
  await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  expect(onError).not.toHaveBeenCalled();
  const host = screen.getByRole("document", { name: "Word document preview" });
  const content = within(host.shadowRoot as unknown as HTMLElement);
  expect(content.getByText("Service notes")).toHaveStyle({ "font-weight": "bold" });
  expect(within(content.getByRole("table")).getByText("Welcome team")).toBeInTheDocument();
  expect(host).toHaveClass("h-full", "w-full", "overflow-auto");
  expect(screen.queryByText("Service notes")).not.toBeInTheDocument();
  view.unmount();
  expect(host.shadowRoot?.textContent).toBe("");
  fetchMock.mockRestore();
});
