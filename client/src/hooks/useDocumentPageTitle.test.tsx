import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useDocumentPageTitle } from "./useDocumentPageTitle";

const TitleProbe = () => {
  useDocumentPageTitle();
  return null;
};

describe("useDocumentPageTitle", () => {
  const originalTitle = document.title;

  afterEach(() => {
    document.title = originalTitle;
  });

  it("sets the document title from the current pathname", () => {
    render(
      <MemoryRouter initialEntries={["/services/share-token"]}>
        <Routes>
          <Route path="/services/:shareId" element={<TitleProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(document.title).toBe("Service plan | WorshipSync");
  });
});
