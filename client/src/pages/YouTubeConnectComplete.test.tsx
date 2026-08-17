import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import YouTubeConnectComplete from "./YouTubeConnectComplete";

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/youtube/connect-complete${search}`]}>
      <Routes>
        <Route
          path="/youtube/connect-complete"
          element={<YouTubeConnectComplete />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe("YouTubeConnectComplete", () => {
  it("shows handoff marks and close-tab instructions on success", () => {
    renderAt(
      "?status=success&accountLabel=Church%20Live&returnTo=%2Faccount%2Fintegrations",
    );

    expect(screen.getByText("Connected to Church Live")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /YouTube to WorshipSync/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Return to WorshipSync\. You can close this browser tab\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Return to WorshipSync/i }),
    ).not.toBeInTheDocument();
  });

  it("points desktop users back to the app without a return link", () => {
    renderAt("?status=success&desktop=1");

    expect(
      screen.getByText(
        /Return to the WorshipSync desktop app\. You can close this browser tab\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Return to WorshipSync/i }),
    ).not.toBeInTheDocument();
  });
});
