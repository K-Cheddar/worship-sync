import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import UserSection from "./UserSection";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import {
  createMockControllerContext,
  createMockGlobalInfo,
} from "../../../test/mocks";

jest.mock("firebase/auth", () => ({
  onAuthStateChanged: jest.fn((_auth, callback) => {
    callback({ displayName: "Alex Operator" });
    return () => undefined;
  }),
}));

jest.mock("../../../firebase/apps", () => ({
  getHumanAuth: jest.fn(() => ({})),
}));

jest.mock("../../../hooks", () => ({
  useSelector: () => false,
}));

jest.mock("../../../components/Button/Button", () => ({
  __esModule: true,
  default: ({
    children,
    onClick,
    className,
    disabled,
    type = "button",
    "aria-label": ariaLabel,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    className?: string;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
    "aria-label"?: string;
  }) => (
    <button
      type={type}
      className={className}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

jest.mock("../../../components/PopOver/PopOver", () => ({
  __esModule: true,
  default: ({
    children,
    TriggeringButton,
  }: {
    children: ReactNode;
    TriggeringButton: ReactNode;
  }) => (
    <div>
      {TriggeringButton}
      <div>{children}</div>
    </div>
  ),
}));

jest.mock("../../../components/Input/Input", () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label="Display name"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock("../../../components/ChurchLogoImg", () => ({
  ChurchLogoImg: () => <div>Logo</div>,
}));

jest.mock("../../../components/Icon/Icon", () => ({
  __esModule: true,
  default: () => <div />,
}));

describe("UserSection", () => {
  it("groups display routes into a single expandable row", () => {
    const globalInfo = createMockGlobalInfo({
      user: "Alex Operator",
      userEmail: "alex@example.com",
      hostId: "host-1",
      activeInstances: [
        {
          database: "main",
          hostId: "host-1",
          isOnController: true,
          lastActive: new Date().toISOString(),
          user: "Alex Operator",
          name: "Alex Operator",
          sessionKind: "human",
          presenceSurface: "controller",
          presenceRoute: "/controller",
        },
        {
          database: "main",
          hostId: "display-1",
          isOnController: false,
          lastActive: new Date().toISOString(),
          user: "Projector PC",
          name: "Projector PC",
          sessionKind: "display",
          presenceSurface: "display",
          presenceRoute: "/projector",
        },
        {
          database: "main",
          hostId: "display-2",
          isOnController: false,
          lastActive: new Date().toISOString(),
          user: "Stream Mac",
          name: "Stream Mac",
          sessionKind: "display",
          presenceSurface: "display",
          presenceRoute: "/stream",
        },
      ],
    });
    const controllerInfo = createMockControllerContext();

    render(
      <GlobalInfoContext.Provider value={globalInfo as never}>
        <ControllerInfoContext.Provider value={controllerInfo as never}>
          <UserSection />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>
    );

    expect(screen.getAllByText("Alex Operator").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /2 displays/i })).toBeInTheDocument();
    expect(screen.queryByText("Projector PC")).not.toBeInTheDocument();
    expect(screen.queryByText("Stream Mac")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /2 displays/i }));

    expect(screen.getByText("Projector PC")).toBeInTheDocument();
    expect(screen.getByText("Stream Mac")).toBeInTheDocument();
    expect(screen.getByText("Projector")).toBeInTheDocument();
    expect(screen.getByText("Stream")).toBeInTheDocument();
  });
});
