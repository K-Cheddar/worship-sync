import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Credit from "../Credit";
import { putCreditDoc } from "../../../utils/dbUtils";
import { resetAppliedCreditVersions } from "../../../utils/creditVersions";

jest.mock("../../../store/store", () => ({
  __esModule: true,
  default: { getState: jest.fn(() => ({})) },
  broadcastCreditsUpdate: jest.fn(),
}));

jest.mock("../../../utils/dbUtils", () => ({
  putCreditDoc: jest.fn(),
}));

jest.mock("../../../utils/creditsHistoryFlush", () => ({
  flushCreditsHistoryFromLatestList: jest.fn().mockResolvedValue(undefined),
}));

const mockDispatch = jest.fn();
jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
}));

jest.mock("../../../context/controllerInfo", () => ({
  ControllerInfoContext: React.createContext<unknown>({
    db: { get: jest.fn(), put: jest.fn() },
  }),
}));

jest.mock("@gsap/react", () => ({ useGSAP: jest.fn() }));
jest.mock("gsap", () => ({
  __esModule: true,
  default: { timeline: () => ({ fromTo: jest.fn() }) },
}));

jest.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
  }),
}));
jest.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

jest.mock("../../../components/Button/Button", () => ({
  __esModule: true,
  default: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" onClick={onClick} />
  ),
}));

jest.mock("../../../components/Input/Input", () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    onFocus,
    onBlur,
  }: {
    value: string;
    onChange: (v: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
  }) => (
    <input
      aria-label="Heading"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  ),
}));

jest.mock("../CreditHistoryTextArea", () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    onFieldFocus,
    onFieldBlur,
  }: {
    value: string;
    onChange: (v: string) => void;
    onFieldFocus?: () => void;
    onFieldBlur?: () => void;
  }) => (
    <textarea
      aria-label="Text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFieldFocus}
      onBlur={onFieldBlur}
    />
  ),
}));

const baseProps = {
  id: "credit-1",
  outlineId: "outline-1",
  initialList: [],
  onSelectCredit: jest.fn(),
  selectedCreditId: "",
  historyLines: [],
};

const renderCredit = (overrides: Partial<React.ComponentProps<typeof Credit>> = {}) =>
  render(<Credit {...baseProps} heading="Band" text="Original" {...overrides} />);

describe("Credit row sync guards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAppliedCreditVersions();
    (putCreditDoc as jest.Mock).mockResolvedValue({
      _id: "credits-outline-1-credit-credit-1",
      id: "credit-1",
      heading: "Band",
      text: "Typed by operator",
      updatedAt: "2026-08-18T10:00:05.000Z",
    });
  });

  it("does not overwrite text the operator is typing when a sync update arrives", async () => {
    const user = userEvent.setup();
    const { rerender } = renderCredit();

    const textField = screen.getByLabelText("Text");
    await user.click(textField);
    await user.type(textField, "!");

    // A remote revision lands mid-edit (replication, broadcast, or reconnect pull).
    rerender(
      <Credit {...baseProps} heading="Band" text="Stale from another surface" />,
    );

    expect(screen.getByLabelText("Text")).toHaveValue("Original!");
  });

  it("does not overwrite a focused field even before the operator types", async () => {
    const user = userEvent.setup();
    const { rerender } = renderCredit();

    await user.click(screen.getByLabelText("Text"));
    rerender(<Credit {...baseProps} heading="Band" text="Arrived while focused" />);

    expect(screen.getByLabelText("Text")).toHaveValue("Original");
  });

  it("adopts held-back values on blur when nothing was typed, without saving over them", async () => {
    const user = userEvent.setup();
    const { rerender } = renderCredit();

    await user.click(screen.getByLabelText("Text"));
    rerender(<Credit {...baseProps} heading="Band" text="Edit from another operator" />);
    await user.tab();

    await waitFor(() =>
      expect(screen.getByLabelText("Text")).toHaveValue("Edit from another operator"),
    );
    expect(putCreditDoc).not.toHaveBeenCalled();
  });

  it("applies remote updates to an idle row", () => {
    const { rerender } = renderCredit();

    rerender(<Credit {...baseProps} heading="Band" text="Updated remotely" />);

    expect(screen.getByLabelText("Text")).toHaveValue("Updated remotely");
  });

  it("adopts values when a different credit takes over the row", async () => {
    const user = userEvent.setup();
    const { rerender } = renderCredit();

    const textField = screen.getByLabelText("Text");
    await user.click(textField);
    await user.type(textField, "!");

    rerender(
      <Credit {...baseProps} id="credit-2" heading="Praise Team" text="Different credit" />,
    );

    expect(screen.getByLabelText("Text")).toHaveValue("Different credit");
  });

  it("saves typed text on blur", async () => {
    const user = userEvent.setup();
    renderCredit();

    const textField = screen.getByLabelText("Text");
    await user.clear(textField);
    await user.type(textField, "Typed by operator");
    await user.tab();

    await waitFor(() => expect(putCreditDoc).toHaveBeenCalled());
    const [, , payload] = (putCreditDoc as jest.Mock).mock.calls.at(-1);
    expect(payload).toMatchObject({ id: "credit-1", text: "Typed by operator" });
  });
});
