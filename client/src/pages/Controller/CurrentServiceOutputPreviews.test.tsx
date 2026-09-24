import { render, screen } from "@testing-library/react";
import CurrentServiceOutputPreviews from "./CurrentServiceOutputPreviews";
import type { DisplayOutput } from "../../utils/displayOutputs";

const state = {
  presentation: { outputs: {} },
  displayOutputs: { list: [] as DisplayOutput[] },
};

jest.mock("../../hooks", () => ({
  useSelector: (selector: (value: typeof state) => unknown) => selector(state),
}));

jest.mock("../../containers/TransmitHandler/ProjectorPresentationPreview", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="projector-tile" data-output-id={props.outputId} data-read-only={props.readOnly} data-visible={props.isVisible}>
      {String(props.name)}
    </div>
  ),
}));
jest.mock("../../containers/TransmitHandler/MonitorPresentationPreview", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => <div data-testid="monitor-tile">{String(props.name)}</div>,
}));
jest.mock("../../containers/TransmitHandler/StreamPresentationPreview", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => <div data-testid="stream-tile">{String(props.name)}</div>,
}));

describe("CurrentServiceOutputPreviews", () => {
  it("renders independently selected projector outputs from the registry as read-only previews", () => {
    const outputs = [
      { id: "projector", type: "projector", name: "Sanctuary", order: 0, enabled: true },
      { id: "tv-one", type: "projector", name: "Foyer TV", order: 1, enabled: true },
      { id: "tv-retired", type: "projector", name: "Retired TV", order: 2, enabled: false },
    ] as DisplayOutput[];
    state.displayOutputs.list = outputs;

    render(
      <CurrentServiceOutputPreviews
        outputs={outputs}
        selectedOutputIds={["projector", "tv-one", "tv-retired"]}
        isVisible={false}
      />,
    );

    expect(screen.getByRole("group", { name: "Selected output previews" })).toHaveClass("grid-cols-1");
    expect(screen.getAllByTestId("projector-tile")).toHaveLength(2);
    expect(screen.getByText("Sanctuary")).toBeInTheDocument();
    expect(screen.getByText("Foyer TV")).toBeInTheDocument();
    expect(screen.queryByText("Retired TV")).not.toBeInTheDocument();
    for (const tile of screen.getAllByTestId("projector-tile")) {
      expect(tile).toHaveAttribute("data-read-only", "true");
      expect(tile).toHaveAttribute("data-visible", "false");
    }
  });

  it("renders a useful empty state when no outputs are selected", () => {
    render(
      <CurrentServiceOutputPreviews outputs={[]} selectedOutputIds={[]} isVisible />,
    );
    expect(screen.getByText(/No output previews are selected/)).toBeInTheDocument();
  });
});
