import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TransferProvider, useTransfers } from "../../context/transferContext";
import { MediaSourceAddMenu } from "./MediaSourceAddMenu";

const Harness = ({ onAddMedia, onImportFromCanva }: { onAddMedia: () => void; onImportFromCanva: () => void }) => {
  const { updateTransfer } = useTransfers();
  return <>
    <MediaSourceAddMenu onAddMedia={onAddMedia} onAddVideoInput={() => undefined} onImportFromCanva={onImportFromCanva} />
    <button onClick={() => updateTransfer({ id: "upload-one", type: "Media upload", name: "photo.png", status: "active", progress: 50 })}>Start upload</button>
  </>;
};

it("keeps all Media source actions available while a shared upload is active", async () => {
  const user = userEvent.setup();
  const onAddMedia = jest.fn();
  const onImportFromCanva = jest.fn();
  render(<MemoryRouter><TransferProvider><Harness onAddMedia={onAddMedia} onImportFromCanva={onImportFromCanva} /></TransferProvider></MemoryRouter>);

  await user.click(screen.getByRole("button", { name: "Start upload" }));
  await user.click(screen.getByRole("button", { name: "Add media" }));
  expect(screen.getByRole("menuitem", { name: "Add files" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Add video input" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Import from Canva" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Download Video" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("menuitem", { name: "Add files" }));
  expect(onAddMedia).toHaveBeenCalledTimes(1);
});

it("exposes Download Video only when the desktop caller provides the native action", async () => {
  const user = userEvent.setup();
  const onDownloadVideo = jest.fn();
  const onAddMedia = jest.fn();
  const onImportFromCanva = jest.fn();
  const Harness = () => <MediaSourceAddMenu
    onAddMedia={onAddMedia}
    onImportFromCanva={onImportFromCanva}
    onDownloadVideo={onDownloadVideo}
  />;
  render(<MemoryRouter><TransferProvider><Harness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Add media" }));
  await user.click(screen.getByRole("menuitem", { name: "Download Video" }));
  expect(onDownloadVideo).toHaveBeenCalledTimes(1);
});

it("shows one Add files action and keeps the requested source order", async () => {
  const user = userEvent.setup();
  const onDownloadVideo = jest.fn();
  const onAddMedia = jest.fn();
  const onAddVideoInput = jest.fn();
  const onAddScreenShare = jest.fn();
  const onImportFromCanva = jest.fn();
  render(<MemoryRouter><TransferProvider><MediaSourceAddMenu
    onDownloadVideo={onDownloadVideo}
    onAddMedia={onAddMedia}
    onAddVideoInput={onAddVideoInput}
    onAddScreenShare={onAddScreenShare}
    onImportFromCanva={onImportFromCanva}
  /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Add media" }));
  const items = screen.getAllByRole("menuitem");
  expect(items.map((item) => item.textContent?.trim())).toEqual([
    "Download Video",
    "Add files",
    "Add video input",
    "Add screen or window",
    "Import from Canva",
  ]);
  expect(screen.getByRole("menuitem", { name: "Add files" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: /Link local video/i })).not.toBeInTheDocument();
});
