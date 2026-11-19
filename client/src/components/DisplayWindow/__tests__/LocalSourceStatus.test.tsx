import { render, screen } from "@testing-library/react";
import LocalSourceStatus from "../LocalSourceStatus";

describe("LocalSourceStatus", () => {
  it("keeps reference-canvas text readable after the parent is scaled", () => {
    render(
      <LocalSourceStatus
        sourceLabel="Local image · Welcome.png"
        size="canvas"
        scaleFactor={0.25}
      />,
    );

    expect(screen.getByRole("status")).toHaveAttribute(
      "data-local-source-status-size",
      "canvas",
    );
    expect(screen.getByText("Local source on another device")).toHaveStyle({
      fontSize: "152px",
    });
  });

  it("keeps thumbnail warnings readable while fitting the scaled thumbnail", () => {
    render(
      <LocalSourceStatus
        sourceLabel="Local image · Welcome.png"
        ownerLabel="Booth PC"
        size="thumbnail"
        scaleFactor={0.2}
      />,
    );

    expect(screen.getByRole("status")).toHaveAttribute(
      "data-local-source-status-size",
      "thumbnail",
    );
    expect(screen.getByText("Local source on another device")).toHaveStyle({
      fontSize: "70px",
    });
    expect(screen.getByText("Available on Booth PC")).toBeInTheDocument();
  });

  it("shows compact indicators with accessible source details and no filesystem path", () => {
    render(
      <LocalSourceStatus
        sourceLabel="Local video · C:\\Media\\Sunday.mp4"
        ownerLabel="Booth PC"
        variant="indicator"
        indicatorLabel="No thumbnail"
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute(
      "aria-label",
      "Local source on another device · Local video · Sunday.mp4 · Available on Booth PC",
    );
    expect(status).toHaveTextContent("No thumbnail");
    expect(status.getAttribute("title")).not.toContain("C:\\Media");
  });

  it("distinguishes loading from unavailable", () => {
    render(
      <LocalSourceStatus
        sourceLabel="Local image · Worship slide.png"
        state="loading"
        heading="Loading local image"
      />,
    );

    expect(screen.getByRole("status")).toHaveAttribute(
      "data-local-source-status-state",
      "loading",
    );
    expect(screen.getByText("Loading local image")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });
});
