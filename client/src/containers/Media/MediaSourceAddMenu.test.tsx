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

  await user.click(screen.getByRole("menuitem", { name: "Add files" }));
  expect(onAddMedia).toHaveBeenCalledTimes(1);
});
