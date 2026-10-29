import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Outlines from "./Outlines";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import { PresentationControllerModeProvider } from "../../../context/presentationControllerMode";
import * as preparedMediaContext from "../../../utils/preparedMediaContext";
import type { RegistrySaveState } from "../../../utils/itemListsRegistryQueue";

const mockDispatch = jest.fn();
const mockShowToast = jest.fn();
let mockMode: "present" | "edit" = "present";
let mockRegistrySave: RegistrySaveState = { status: "idle" };

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
            registrySave: mockRegistrySave,
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
  useToast: () => ({ showToast: mockShowToast }),
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

jest.mock("../../../components/PopOver/PopoverPanel", () => ({
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
    mockRegistrySave = { status: "idle" };
  });

  it("shows a concise error for current edits without historical branch comparisons", () => {
    mockRegistrySave = { status: "error", hasCurrentConflicts: true };
    render(<GlobalInfoContext.Provider value={{ access: "full" } as never}><Outlines /></GlobalInfoContext.Provider>);
    expect(screen.getByRole("region", { name: "Outline save error" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your unsaved outline changes remain available");
    expect(screen.getByRole("button", { name: "Retry save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keep my changes" })).toBeEnabled();
    expect(screen.queryByText("Keep: Local name")).not.toBeInTheDocument();
    expect(screen.queryByText("Use saved: Saved name")).not.toBeInTheDocument();
    expect(screen.queryByText(/competing saved versions/i)).not.toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("Another saved edit overlaps"), "error");
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

  it("refreshes from the winner after a losing-revision event without branch review", async () => {
    const base = {
      _id: "ItemLists",
      _rev: "1-base",
      itemLists: [{ _id: "outline-1", name: "Sunday Service" }],
      activeList: { _id: "outline-1", name: "Sunday Service" },
    };
    const conflicted = {
      ...base,
      _rev: "2-winner",
      _conflicts: ["2-losing"],
      itemLists: [{ _id: "outline-1", name: "Remote rename" }],
      activeList: { _id: "outline-1", name: "Remote rename" },
    };
    const db = { get: jest.fn().mockResolvedValueOnce(base).mockResolvedValue(conflicted) } as any;
    const updater = new EventTarget();
    render(
      <ControllerInfoContext.Provider value={{ db, updater } as never}>
        <PresentationControllerModeProvider>
          <GlobalInfoContext.Provider value={{ access: "full" } as never}>
            <Outlines />
          </GlobalInfoContext.Provider>
        </PresentationControllerModeProvider>
      </ControllerInfoContext.Provider>,
    );
    await waitFor(() => expect(db.get).toHaveBeenCalledTimes(1));

    await act(async () => {
      updater.dispatchEvent(new CustomEvent("update", {
        detail: [{
          _id: "ItemLists",
          _rev: "2-losing",
          itemLists: [{ _id: "outline-1", name: "Losing rename" }],
          activeList: { _id: "outline-1", name: "Losing rename" },
        }],
      }));
      await Promise.resolve();
    });
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: expect.stringContaining("updateItemListsFromRemote"),
      payload: expect.objectContaining({
        itemLists: [{ _id: "outline-1", name: "Remote rename" }],
      }),
    })));
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.stringContaining("competing saved versions"), "error");
    expect(db.get).toHaveBeenLastCalledWith("ItemLists");
    expect(db.get).toHaveBeenCalledTimes(2);

    await act(async () => {
      updater.dispatchEvent(new CustomEvent("update", {
        detail: [{
          _id: "ItemLists",
          _rev: "2-losing",
          itemLists: [{ _id: "outline-1", name: "Losing rename" }],
        }],
      }));
      await Promise.resolve();
    });
    expect(db.get).toHaveBeenCalledTimes(2);
  });

  it("ignores a registry read that settles after the database changes", async () => {
    const base = {
      _id: "ItemLists",
      _rev: "1-base",
      itemLists: [{ _id: "outline-1", name: "Sunday Service" }],
      activeList: { _id: "outline-1", name: "Sunday Service" },
    };
    const oldRemote = {
      ...base,
      _rev: "2-old-database",
      itemLists: [{ _id: "outline-1", name: "Stale database value" }],
      activeList: { _id: "outline-1", name: "Stale database value" },
    };
    const newRemote = {
      ...base,
      _rev: "2-new-database",
      itemLists: [{ _id: "outline-1", name: "Current database value" }],
      activeList: { _id: "outline-1", name: "Current database value" },
    };
    let resolveOldRead!: (doc: typeof oldRemote) => void;
    const oldRead = new Promise<typeof oldRemote>((resolve) => { resolveOldRead = resolve; });
    const dbA = { get: jest.fn().mockResolvedValueOnce(base).mockReturnValueOnce(oldRead) } as any;
    const dbB = { get: jest.fn().mockResolvedValue(newRemote) } as any;
    const updaterA = new EventTarget();
    const updaterB = new EventTarget();
    const renderWith = (db: unknown, updater: EventTarget) => (
      <ControllerInfoContext.Provider value={{ db, updater } as never}>
        <PresentationControllerModeProvider>
          <GlobalInfoContext.Provider value={{ access: "full" } as never}>
            <Outlines />
          </GlobalInfoContext.Provider>
        </PresentationControllerModeProvider>
      </ControllerInfoContext.Provider>
    );
    const view = render(renderWith(dbA, updaterA));
    await waitFor(() => expect(dbA.get).toHaveBeenCalledTimes(1));

    act(() => updaterA.dispatchEvent(new CustomEvent("update", {
      detail: [{ _id: "ItemLists", _rev: "2-old-database" }],
    })));
    await waitFor(() => expect(dbA.get).toHaveBeenCalledTimes(2));
    mockDispatch.mockClear();

    view.rerender(renderWith(dbB, updaterB));
    await waitFor(() => expect(dbB.get).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        itemLists: [{ _id: "outline-1", name: "Current database value" }],
      }),
    })));

    await act(async () => { resolveOldRead(oldRemote); });
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        itemLists: [{ _id: "outline-1", name: "Stale database value" }],
      }),
    }));
  });
});
