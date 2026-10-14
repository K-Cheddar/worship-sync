import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getPublicServiceFlow } from "../services/serviceFlowApi";
import type { PublicServiceFlowSnapshot } from "../services/serviceFlowTypes";
import PublicApp from "./PublicApp";

let mockBoardPending: Promise<void> | null = null;
jest.mock("../pages/BoardPresent", () => () => {
  if (mockBoardPending) throw mockBoardPending;
  return <div>Board presentation</div>;
});

it("keeps public board presentation chunk loading transparent", async () => {
  window.history.replaceState({}, "", "/boards/present/alias?preview=1");
  let finish!: () => void;
  mockBoardPending = new Promise<void>((resolve) => { finish = resolve; });
  const { container } = render(<PublicApp />);
  // Flush the actual lazy import before checking its suspended fallback.
  // eslint-disable-next-line testing-library/no-unnecessary-act
  await act(async () => {});
  expect(container).toBeEmptyDOMElement();
  await act(async () => { mockBoardPending = null; finish(); });
  expect(screen.getByText("Board presentation")).toBeInTheDocument();
});

jest.mock("../services/serviceFlowApi", () => ({
  ...jest.requireActual("../services/serviceFlowApi"),
  getPublicServiceFlow: jest.fn(),
}));

jest.mock("../components/HomeToolbarMenu/HomeToolbarMenu", () => () => (
  <button type="button" aria-label="Open menu">
    Menu
  </button>
));

const mockGetPublicServiceFlow = jest.mocked(getPublicServiceFlow);

const detailedServiceSnapshot: PublicServiceFlowSnapshot = {
  success: true,
  churchName: "Grace Chapel",
  serverNowMs: Date.now(),
  roles: [
    { positionId: "lead", label: "Lead vocal", teamId: "worship", teamName: "Worship Team" },
    { positionId: "keys", label: "Keys", teamId: "worship", teamName: "Worship Team" },
  ],
  service: {
    shareId: "share-token",
    viewMode: "team",
    title: "Sunday Service",
    startsAt: new Date(Date.now() - 30_000).toISOString(),
    timezone: "UTC",
    revision: 1,
    live: { mode: "schedule" },
    sections: [{
      id: "worship",
      title: "Worship",
      items: [{
        id: "opening-song",
        title: "Opening song",
        durationSeconds: 300,
        notes: { blocks: [] },
        teamNotes: [
          {
            label: "Lead vocal",
            scope: "role",
            positionId: "lead",
            teamId: "worship",
            teamName: "Worship Team",
            notes: { blocks: [{ type: "paragraph", spans: [{ text: "Lead vocal cue" }] }] },
          },
          {
            label: "Keys",
            scope: "role",
            positionId: "keys",
            teamId: "worship",
            teamName: "Worship Team",
            notes: { blocks: [{ type: "paragraph", spans: [{ text: "Keyboard cue" }] }] },
          },
        ],
      }],
    }],
  },
};

describe("PublicApp SMS opt-in route", () => {
  it("renders the demo tenant through the public app shell", async () => {
    window.history.pushState({}, "", "/sms-opt-in/demo");

    render(<PublicApp onLeaveToOperatorApp={jest.fn()} />);

    expect(
      await screen.findByRole("heading", { name: "Optional SMS updates" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No thanks — continue without SMS" })).toBeInTheDocument();
  });

  it("hands the continuation link off to the unauthenticated app root", async () => {
    const user = userEvent.setup();
    const onLeaveToOperatorApp = jest.fn();
    window.history.pushState({}, "", "/sms-opt-in/demo");

    render(<PublicApp onLeaveToOperatorApp={onLeaveToOperatorApp} />);
    await user.click(await screen.findByRole("button", { name: "No thanks — continue without SMS" }));
    await user.click(screen.getByRole("link", { name: "Continue to WorshipSync" }));

    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(onLeaveToOperatorApp).toHaveBeenCalledWith("/");
  });
});

describe("PublicApp public service route", () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetPublicServiceFlow.mockReset();
    mockGetPublicServiceFlow.mockResolvedValue(detailedServiceSnapshot);
    window.history.pushState({}, "", "/services/share-token");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("filters role notes through the real public route without authenticated providers", async () => {
    const user = userEvent.setup();
    // PublicApp supplies its production BrowserRouter, ToastProvider, lazy route,
    // and ErrorBoundary composition. Deliberately do not wrap this in Redux Provider.
    render(<PublicApp onLeaveToOperatorApp={jest.fn()} />);

    expect(await screen.findByRole("heading", { name: "Sunday Service" })).toBeInTheDocument();
    expect(screen.queryByText("This section could not load.")).not.toBeInTheDocument();
    expect(mockGetPublicServiceFlow).toHaveBeenCalledWith("share-token");
    expect(screen.getByText("Lead vocal cue")).toBeInTheDocument();
    expect(screen.getByText("Keyboard cue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter role notes" }));
    await screen.findByRole("region", { name: "Role options" });
    await user.click(screen.getByRole("button", { name: "Lead vocal" }));

    expect(screen.getByRole("heading", { name: "Sunday Service" })).toBeInTheDocument();
    expect(screen.getByText("Lead vocal cue")).toBeInTheDocument();
    expect(screen.queryByText("Keyboard cue")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByText("This section could not load.")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Role options" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter role notes: Lead vocal" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Filter role notes: Lead vocal" }));
    expect(await screen.findByRole("region", { name: "Role options" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lead vocal" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("This section could not load.")).not.toBeInTheDocument();
  });
});
