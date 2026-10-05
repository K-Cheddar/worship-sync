import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExternalResourceDialog } from "./ExternalResourceDialog";
import { createExternalChurchResource } from "../api/auth";
import type { ChurchResource } from "../types/churchResource";

jest.mock("../api/auth", () => ({ createExternalChurchResource: jest.fn() }));

const resource: ChurchResource = {
  id: "resource-1", churchId: "church-1", name: "Guide", kind: "document", sourceType: "external",
  external: { url: "https://example.test/guide.pdf", provider: "direct", mediaType: "document" },
  createdAt: "2026-10-05", createdBy: "user-1", updatedAt: "2026-10-05", updatedBy: "user-1",
};
const mockCreate = jest.mocked(createExternalChurchResource);

beforeEach(() => mockCreate.mockReset());

test("retains its standalone trigger and closes on success", async () => {
  const user = userEvent.setup();
  const onCreated = jest.fn();
  mockCreate.mockResolvedValue(resource);
  render(<ExternalResourceDialog churchId="church-1" onCreated={onCreated} />);
  await user.click(screen.getByRole("button", { name: "Add external link" }));
  await user.type(screen.getByRole("textbox", { name: "URL:" }), resource.external.url);
  await user.click(screen.getByRole("button", { name: "Add resource" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(resource));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("controlled saving blocks dismissal, keeps errors available for retry, and closes after success", async () => {
  const user = userEvent.setup();
  const onCreated = jest.fn();
  const onOpenChange = jest.fn();
  let fail!: (error: Error) => void;
  mockCreate.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const ControlledDialog = () => {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>Open external resource</button>
      <ExternalResourceDialog churchId="church-1" onCreated={onCreated} open={open} showTrigger={false} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} />
    </>;
  };
  render(<ControlledDialog />);
  expect(screen.queryByRole("button", { name: "Add external link" })).not.toBeInTheDocument();
  const opener = screen.getByRole("button", { name: "Open external resource" });
  await user.click(opener);
  await user.type(screen.getByRole("textbox", { name: "URL:" }), resource.external.url);
  await user.type(screen.getByRole("textbox", { name: "Name (optional):" }), "Guide");
  await user.click(screen.getByRole("button", { name: "Add resource" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-busy", "true");
  expect(within(dialog).getByRole("button", { name: "Add resource" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Close modal" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close modal" }));
  await user.keyboard("{Escape}");
  fireEvent.pointerDown(opener);
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => fail(new Error("Could not check the link. Try again.")));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not check the link");
  expect(screen.getByRole("textbox", { name: "URL:" })).toHaveValue(resource.external.url);
  expect(screen.getByRole("button", { name: "Add resource" })).toBeEnabled();
  mockCreate.mockResolvedValue(resource);
  await user.click(screen.getByRole("button", { name: "Add resource" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(resource));
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(opener);
  expect(screen.getByRole("textbox", { name: "URL:" })).toHaveValue("");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});
