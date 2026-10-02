import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import Outlines from "./Outlines";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { PresentationControllerModeProvider } from "../../../context/presentationControllerMode";
import * as preparedMediaContext from "../../../utils/preparedMediaContext";

const mockDispatch = jest.fn();
let mockMode: "present" | "edit" = "present";

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      undoable: {
        present: {
          itemLists: {
            currentLists: [{ _id: "outline-1", name: "Sunday Service" }],
            activeList: { _id: "outline-1", name: "Sunday Service" },
            selectedList: { _id: "outline-1", name: "Sunday Service" },
            scope: "presentation",
            isInitialized: true,
          },
        },
      },
    }),
}));

jest.mock("../../../context/presentationControllerMode", () => ({
  ...jest.requireActual("../../../context/presentationControllerMode"),
  usePresentationControllerMode: () => ({ mode: mockMode, setMode: jest.fn() }),
}));

jest.mock("../../../context/activeController", () => ({
  useActiveControllerProfile: () => ({
    id: "presentation",
    name: "Presentation",
    outlineScope: "presentation",
  }),
}));

jest.mock("../../../context/toastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock("../../../hooks/useGlobalBroadcast", () => ({ useGlobalBroadcast: jest.fn() }));

jest.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useDroppable: () => ({ setNodeRef: jest.fn() }),
}));

jest.mock("../../../utils/dndUtils", () => ({ useSensors: () => [] }));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: jest.fn(),
}));

jest.mock("../../../components/PopOver/PopOver", () => ({
  __esModule: true,
  default: ({ TriggeringButton, children }: { TriggeringButton: ReactNode; children: ReactNode }) => (
    <div>{TriggeringButton}{children}</div>
  ),
}));

jest.mock("./Outline", () => ({
  __esModule: true,
  default: ({ list, selectList, canEdit }: {
    list: { _id: string; name: string };
    selectList: (id: string) => void;
    canEdit: boolean;
  }) => (
    <li>
      <button type="button" onClick={() => selectList(list._id)}>{list.name}</button>
      {canEdit && <button type="button">Edit outline</button>}
    </li>
  ),
}));

describe("Outlines", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMode = "present";
  });

  it("allows outline selection in present mode without showing management actions", () => {
    const publishContext = jest.spyOn(preparedMediaContext, "publishPreparedMediaContext");
    render(
      <PresentationControllerModeProvider>
        <GlobalInfoContext.Provider value={{ access: "full" } as never}>
          <Outlines />
        </GlobalInfoContext.Provider>
      </PresentationControllerModeProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Sunday Service" })[1]);

    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: expect.stringContaining("selectItemList") }));
    expect(publishContext).toHaveBeenCalledWith(expect.objectContaining({
      controllerProfileId: "presentation",
      outlineScope: "presentation",
      outlineId: "outline-1",
      contextSource: "local runtime selection",
    }));
    expect(screen.queryByRole("button", { name: "Edit outline" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add New Service" })).not.toBeInTheDocument();
  });

  it("keeps outline management actions available in edit mode", () => {
    mockMode = "edit";
    render(
      <PresentationControllerModeProvider>
        <GlobalInfoContext.Provider value={{ access: "full" } as never}>
          <Outlines />
        </GlobalInfoContext.Provider>
      </PresentationControllerModeProvider>,
    );

    expect(screen.getByRole("button", { name: "Edit outline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add New Service" })).toBeInTheDocument();
  });
});
