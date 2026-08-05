import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import TeamsTemplatesPage, { nextTemplateCopyName } from "./TeamsTemplatesPage";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastProvider } from "../../../context/toastContext";
import { createMockGlobalContext } from "../../../test/mocks";
import {
  listServicePlanTemplates,
  saveServicePlanTemplate,
} from "../../../api/auth";
import { plainTextToRichText } from "../../../types/richText";
import type { TeamService } from "../../../api/authTypes";
import type { ServicePlanTemplate } from "../../../types/servicePlan";

jest.mock("../../../api/auth", () => ({
  listServicePlanTemplates: jest.fn(),
  saveServicePlanTemplate: jest.fn(),
  deleteServicePlanTemplate: jest.fn(),
  // The template editor loads the church's microphones so a template can carry
  // its own mic plan; this page never asserts on them.
  getServicePlanMicrophones: jest.fn().mockResolvedValue({
    success: true,
    microphones: [],
    audiences: [],
  }),
}));

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      allDocs: { allSongDocs: [] },
      allItems: { list: [], isAllItemsLoading: false },
    }),
  useDispatch: () => jest.fn(),
}));

const services: TeamService[] = [
  {
    id: "service-1",
    serviceId: "service-1",
    churchId: "church-1",
    name: "Sabbath Service",
    timerType: "countdown",
    reccurence: "weekly",
  },
];

let mockCanEditTeams = true;
jest.mock("../TeamsPageContext", () => ({
  useTeamsPage: () => ({
    pageData: {
      services,
      positions: [],
      teams: [],
      members: [],
      schedules: [],
    },
    canEditTeams: mockCanEditTeams,
  }),
}));

const mockListServicePlanTemplates = jest.mocked(listServicePlanTemplates);
const mockSaveServicePlanTemplate = jest.mocked(saveServicePlanTemplate);

const template = (
  overrides: Partial<ServicePlanTemplate> = {},
): ServicePlanTemplate => ({
  templateId: "template-1",
  churchId: "church-1",
  name: "Standard Sabbath",
  serviceId: "service-1",
  sections: [
    {
      id: "section-1",
      name: "Worship",
      elements: [
        {
          id: "element-1",
          type: "free",
          title: plainTextToRichText("Opening prayer"),
        },
      ],
    },
  ],
  ...overrides,
});

const renderPage = ({ canEdit = true }: { canEdit?: boolean } = {}) => {
  mockCanEditTeams = canEdit;
  return render(
    <GlobalInfoContext.Provider
      value={
        createMockGlobalContext({
          churchId: "church-1",
          canEditServices: canEdit,
          canEditTeams: canEdit,
        }) as ContextType<typeof GlobalInfoContext>
      }
    >
      <ToastProvider>
        <TeamsTemplatesPage />
      </ToastProvider>
    </GlobalInfoContext.Provider>,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCanEditTeams = true;
  mockListServicePlanTemplates.mockResolvedValue({
    success: true,
    templates: [template()],
  });
  mockSaveServicePlanTemplate.mockResolvedValue({
    success: true,
    template: template({ templateId: "template-2", name: "Copy of Standard Sabbath" }),
  });
});

describe("nextTemplateCopyName", () => {
  it("prefixes with Copy of", () => {
    expect(nextTemplateCopyName("Standard Sabbath", [])).toBe(
      "Copy of Standard Sabbath",
    );
  });

  it("numbers further copies rather than colliding", () => {
    expect(
      nextTemplateCopyName("Standard Sabbath", [
        "Standard Sabbath",
        "Copy of Standard Sabbath",
      ]),
    ).toBe("Copy of Standard Sabbath 2");
  });

  it("ignores case and surrounding space when checking for collisions", () => {
    expect(
      nextTemplateCopyName("Standard Sabbath", ["  copy of standard sabbath "]),
    ).toBe("Copy of Standard Sabbath 2");
  });
});

describe("TeamsTemplatesPage", () => {
  it("shows a loading skeleton while templates are fetching", async () => {
    let resolveList: ((value: {
      success: true;
      templates: ServicePlanTemplate[];
    }) => void) | undefined;
    mockListServicePlanTemplates.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    renderPage();

    expect(
      screen.getByRole("status", { name: "Loading templates" }),
    ).toBeInTheDocument();

    resolveList?.({ success: true, templates: [template()] });
    expect(await screen.findByText("Standard Sabbath")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Loading templates" }),
    ).not.toBeInTheDocument();
  });

  it("lists each template with its scope and size", async () => {
    renderPage();

    expect(await screen.findByText("Standard Sabbath")).toBeInTheDocument();
    expect(screen.getByText("1 section · 1 item")).toBeInTheDocument();
    expect(screen.getByText("Preferred for Sabbath Service")).toBeInTheDocument();
  });

  it("labels a template with no service as available anywhere", async () => {
    mockListServicePlanTemplates.mockResolvedValue({
      success: true,
      templates: [template({ serviceId: undefined })],
    });
    renderPage();

    expect(await screen.findByText("Any service")).toBeInTheDocument();
  });

  it("explains the empty state and offers a first template", async () => {
    mockListServicePlanTemplates.mockResolvedValue({
      success: true,
      templates: [],
    });
    renderPage();

    expect(await screen.findByText("No templates yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New template/ }),
    ).toBeInTheDocument();
  });

  it("opens the editor when the template card is clicked and comes back to the list", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Edit Standard Sabbath" }),
    );

    expect(
      await screen.findByRole("region", { name: "Service plan template" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Worship")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to Templates" }));

    expect(await screen.findByText("Standard Sabbath")).toBeInTheDocument();
  });

  it("duplicates a template with fresh ids and a non-colliding name", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Duplicate Standard Sabbath" }),
    );

    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalled());
    const [, body] = mockSaveServicePlanTemplate.mock.calls[0];
    expect(body.name).toBe("Copy of Standard Sabbath");
    expect(body.serviceId).toBe("service-1");
    expect(body).not.toHaveProperty("templateId");
    // Cloned rows must not share ids with the original, or editing the copy
    // would reach into the template it came from.
    expect(body.sections[0].id).not.toBe("section-1");
    expect(body.sections[0].elements[0].id).not.toBe("element-1");
  });

  it("filters the list by name", async () => {
    const user = userEvent.setup();
    mockListServicePlanTemplates.mockResolvedValue({
      success: true,
      templates: [template(), template({ templateId: "template-2", name: "Communion" })],
    });
    renderPage();

    await screen.findByText("Communion");
    await user.type(screen.getByPlaceholderText("Search templates"), "commun");

    expect(screen.getByText("Communion")).toBeInTheDocument();
    expect(screen.queryByText("Standard Sabbath")).not.toBeInTheDocument();
  });

  it("gives a viewer read-only access", async () => {
    renderPage({ canEdit: false });

    expect(
      await screen.findByRole("button", { name: "View Standard Sabbath" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /New template/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Duplicate/ }),
    ).not.toBeInTheDocument();
  });
});
