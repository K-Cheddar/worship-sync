import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MediaOriginFilter from "./MediaOriginFilter";
import { MEDIA_LIBRARY_ORIGIN_FILTER_LABELS } from "./mediaLibraryOrigin";

describe("MediaOriginFilter", () => {
  it("lists every supported source in a compact select", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<MediaOriginFilter value="all" onChange={onChange} />);

    const trigger = screen.getByRole("combobox", { name: /source/i });
    expect(trigger).toHaveTextContent("All sources");

    await user.click(trigger);
    expect(
      await screen.findByRole("option", { name: "Uploaded" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Local" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Video inputs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Canva" })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Video inputs" }));
    expect(onChange).toHaveBeenCalledWith("video-input");
  });

  it("shows the selected source label", () => {
    render(<MediaOriginFilter value="canva" onChange={jest.fn()} />);
    expect(screen.getByRole("combobox", { name: /source/i })).toHaveTextContent(
      MEDIA_LIBRARY_ORIGIN_FILTER_LABELS.canva,
    );
  });
});
