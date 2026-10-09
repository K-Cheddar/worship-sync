import React from "react";
import { getCanvaStatus } from "../../../api/canva";
import { fromLegacyPresentationShape } from "../../../store/presentationSlice";
import { upsertItemInAllItemsList } from "../../../store/allItemsSlice";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Media, { getMediaPanelClassName } from "../Media";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { createNewFreeForm } from "../../../utils/itemUtil";
import { claimMediaUpload } from "../../../utils/mediaOperationClaims";
import { MEDIA_LIBRARY_ROOT_VIEW } from "../../../utils/mediaFolderMutations";

const mockDispatch = jest.fn();
const mockDeleteMediaItemsFromPouch = jest.fn();
const mockDeleteMediaItemAtRevisionFromPouch = jest.fn();
const mockReadMediaItemForDeletion = jest.fn();
const mockSweepMediaReferencesBeforeDelete = jest.fn();
const mockDeleteCloudinaryMediaAsset = jest.fn();
const mockDeleteMuxAsset = jest.fn();
const mockCreateNewFreeForm = jest.fn();
const mockUseLocation = jest.fn();
const mockOpenModal = jest.fn();
const mockSelectionHandleClick = jest.fn();
const mockClearSelection = jest.fn();
const mockUseGlobalBroadcast = jest.fn();
const mockSetSelectedQuickLinkImage = jest.fn((payload: any) => ({
  type: "preferences/setSelectedQuickLinkImage",
  payload,
}));
const mockSetDefaultPreferences = jest.fn((payload: any) => ({
  type: "preferences/setDefaultPreferences",
  payload,
}));
const mockUpdateOverlay = jest.fn((payload: any) => ({
  type: "overlay/updateOverlay",
  payload,
}));
const mockUpdateOverlayInList = jest.fn((payload: any) => ({
  type: "overlays/updateOverlayInList",
  payload,
}));
const mockTransfers = new Map<string, any>();
const mockUpdateTransfer = jest.fn((transfer: { id: string }) => mockTransfers.set(transfer.id, transfer));
const mockGetTransfer = jest.fn((id: string) => mockTransfers.get(id));
const mockTransferActionHandlers = new Map<string, () => void | Promise<void>>();
const mockRegisterTransferAction = jest.fn((
  transferId: string,
  key: string,
  handler: () => void | Promise<void>,
) => {
  const actionKey = `${transferId}:${key}`;
  mockTransferActionHandlers.set(actionKey, handler);
  return () => mockTransferActionHandlers.delete(actionKey);
});
const mockRemoveTransfer = jest.fn((id: string) => mockTransfers.delete(id));
const mockUpdateSlideBackground = jest.fn((payload: any) => ({
  type: "item/updateSlideBackground",
  payload,
}));
const mockRepairPersistedMediaRouteFolders = jest.fn();
const mockBroadcastRouteFolderDocs = jest.fn();
let mockBroadcastTarget: { postMessage: jest.Mock } = { postMessage: jest.fn() };

let mockState: any;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const mockInitiateMediaList = jest.fn((payload: any) => ({
  type: "media/initiateMediaList",
  payload,
}));
const mockSetMediaItems = jest.fn((payload: number) => ({
  type: "preferences/setMediaItems",
  payload,
}));

const emptySelectedMedia = {
  id: "",
  background: "",
  type: "image" as const,
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "",
  height: 0,
  width: 0,
  publicId: "",
  name: "",
  thumbnail: "",
  placeholderImage: "",
  source: "cloudinary" as const,
};

let mockSelectedMedia: typeof emptySelectedMedia = emptySelectedMedia;
let mockSelectedMediaIds = new Set<string>();

jest.mock("../../../context/transferContext", () => ({
  useTransferActions: () => ({ startCanvaTransfer: jest.fn() }),
  useTransfers: () => ({
    transfers: [],
    startCanvaTransfer: jest.fn(),
    updateTransfer: jest.fn(),
    removeTransfer: jest.fn(),
    runTransferAction: jest.fn(),
  }),
  useOptionalTransfers: () => null,
  useOptionalTransferActions: () => ({
    updateTransfer: mockUpdateTransfer,
    getTransfer: mockGetTransfer,
    registerTransferAction: mockRegisterTransferAction,
    removeTransfer: mockRemoveTransfer,
  }),
  getTransferOverview: () => ({
    progress: null,
    activeCount: 0,
    transfers: [],
  }),
}));

jest.mock("react-redux", () => ({
  ...jest.requireActual("react-redux"),
  useStore: () => ({
    getState: () => mockState,
    dispatch: mockDispatch,
    subscribe: () => () => undefined,
  }),
}));

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
  useMediaSelection: () => ({
    selectedMedia: mockSelectedMedia,
    selectedMediaIds: mockSelectedMediaIds,
    previewMedia: null,
    mediaMultiSelectMode: false,
    setPreviewMedia: jest.fn(),
    setSelectedMediaIds: jest.fn(),
    handleMediaClick: mockSelectionHandleClick,
    enterMediaMultiSelectMode: jest.fn(),
    clearSelection: mockClearSelection,
    reconcileSelectionWithMediaList: jest.fn(),
  }),
}));

jest.mock("../../../hooks/useGlobalBroadcast", () => ({
  useGlobalBroadcast: (cb: (...args: unknown[]) => unknown) =>
    mockUseGlobalBroadcast(cb),
}));

const mockNavigate = jest.fn();
const mockShowToast = jest.fn();
const mockUpdateToast = jest.fn();
var mockFlushMediaLibraryDocToPouch = jest.fn();

jest.mock("../../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
    updateToast: mockUpdateToast,
    removeToast: jest.fn(),
  }),
}));

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useLocation: () => mockUseLocation(),
  useNavigate: () => mockNavigate,
}));

jest.mock("../../../store/mediaSlice", () => ({
  initiateMediaList: (payload: any) => mockInitiateMediaList(payload),
  syncMediaFromRemote: jest.fn((payload: any) => ({
    type: "media/syncMediaFromRemote",
    payload,
  })),
  setMediaListAndFolders: jest.fn((payload: any) => ({
    type: "media/setMediaListAndFolders",
    payload,
  })),
  removeMediaItemFromRemote: jest.fn((payload: string) => ({
    type: "media/removeMediaItemFromRemote",
    payload,
  })),
  updateMediaList: jest.fn((payload: any) => ({
    type: "media/updateMediaList",
    payload,
  })),
  updateMediaListFromRemote: jest.fn((payload: any) => ({
    type: "media/updateMediaListFromRemote",
    payload,
  })),
  addItemToMediaList: jest.fn((payload: any) => ({
    type: "media/addItemToMediaList",
    payload,
  })),
  updateMediaItemFields: jest.fn((payload: any) => ({
    type: "media/updateMediaItemFields",
    payload,
  })),
}));

jest.mock("../../../store/preferencesSlice", () => ({
  setDefaultPreferences: (payload: any) => mockSetDefaultPreferences(payload),
  setIsMediaExpanded: jest.fn((payload: boolean) => ({
    type: "preferences/setIsMediaExpanded",
    payload,
  })),
  setMediaItems: (payload: number) => mockSetMediaItems(payload),
  setSelectedQuickLinkImage: (payload: any) =>
    mockSetSelectedQuickLinkImage(payload),
  setMediaRouteFolder: jest.fn((payload: any) => ({
    type: "preferences/setMediaRouteFolder",
    payload,
  })),
  repairActiveMediaRouteFolders: jest.fn((payload: any) => ({
    type: "preferences/repairActiveMediaRouteFolders",
    payload,
  })),
}));

jest.mock("../../../store/itemSlice", () => ({
  updateAllSlideBackgrounds: jest.fn((payload: any) => ({
    type: "item/updateAllSlideBackgrounds",
    payload,
  })),
  updateSlideBackground: (payload: any) => mockUpdateSlideBackground(payload),
  setActiveItem: jest.fn((payload: any) => ({
    type: "item/setActiveItem",
    payload,
  })),
}));

jest.mock("../../../store/overlaysSlice", () => ({
  updateOverlayInList: (payload: any) => mockUpdateOverlayInList(payload),
}));

jest.mock("../../../store/overlaySlice", () => ({
  updateOverlay: (payload: any) => mockUpdateOverlay(payload),
}));

jest.mock("../../../utils/cloudinaryUtils", () => ({
  deleteFromCloudinary: jest.fn().mockResolvedValue(true),
  extractPublicId: jest.fn(() => "mock-public-id"),
}));

jest.mock("../../../components/ErrorBoundary/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../MediaTypeBadge", () => ({
  __esModule: true,
  default: () => <span data-testid="media-type-badge" />,
}));

jest.mock("../../../components/Modal/DeleteModal", () => ({
  __esModule: true,
  default: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <button type="button" onClick={onConfirm}>
        confirm-delete
      </button>
    ) : null,
}));

jest.mock("../MediaModal", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../../../utils/mediaReferenceSweep", () => ({
  sweepMediaReferencesBeforeDelete: (...args: unknown[]) =>
    mockSweepMediaReferencesBeforeDelete(...args),
}));

jest.mock("../../../utils/controllerMediaRouteFolders", () => ({
  repairPersistedMediaRouteFolders: (...args: unknown[]) =>
    mockRepairPersistedMediaRouteFolders(...args),
  broadcastControllerMediaRouteFoldersUpdate: (
    docs: unknown[],
    publishIfCurrent: () => boolean = () => true,
  ) => {
    mockBroadcastRouteFolderDocs(docs, publishIfCurrent);
    if (publishIfCurrent()) {
      mockBroadcastTarget.postMessage({ type: "update", data: { docs } });
    }
  },
}));

jest.mock("../../../utils/flushMediaLibraryDoc", () => ({
  deleteMediaItemAtRevisionFromPouch: (...args: unknown[]) =>
    mockDeleteMediaItemAtRevisionFromPouch(...args),
  deleteMediaItemsFromPouch: (...args: unknown[]) =>
    mockDeleteMediaItemsFromPouch(...args),
  flushMediaLibraryDocToPouch: (...args: unknown[]) =>
    mockFlushMediaLibraryDocToPouch(...args),
}));

jest.mock("../../../utils/mediaDocUtils", () => ({
  ...jest.requireActual("../../../utils/mediaDocUtils"),
  readMediaItemForDeletion: (...args: unknown[]) =>
    mockReadMediaItemForDeletion(...args),
}));

jest.mock("../../../api/providerStorage", () => ({
  deleteCloudinaryMediaAsset: (...args: unknown[]) =>
    mockDeleteCloudinaryMediaAsset(...args),
  deleteChurchMuxAsset: (...args: unknown[]) => mockDeleteMuxAsset(...args),
}));

jest.mock("../../../utils/itemUtil", () => ({
  ...jest.requireActual("../../../utils/itemUtil"),
  createNewFreeForm: (...args: unknown[]) => mockCreateNewFreeForm(...args),
}));

jest.mock("../../../api/canva", () => ({
  getCanvaStatus: jest.fn(),
}));

jest.mock("../../../context/globalInfo", () => {
  const ReactLib = require("react") as typeof React;
  return {
    GlobalInfoContext: ReactLib.createContext({
      churchId: "church-1",
    }),
  };
});

const mockGetCanvaStatus = getCanvaStatus as jest.MockedFunction<
  typeof getCanvaStatus
>;

jest.mock("../MediaUploadInput", () => {
  const ReactLib = require("react") as typeof React;
  return {
    __esModule: true,
    default: ReactLib.forwardRef(
      (
        _props: Record<string, never>,
        ref: React.Ref<{ openModal: () => void; openModalWithFiles: (files: File[]) => void }>,
      ) => {
        ReactLib.useImperativeHandle(ref, () => ({
          openModal: mockOpenModal,
          openModalWithFiles: mockOpenModal,
        }));
        return null;
      },
    ),
  };
});

const makeBaseState = (overrides: Partial<any> = {}) => {
  const base = {
    presentation: fromLegacyPresentationShape({
      isProjectorTransmitting: false,
    }),
    allItems: {
      list: [] as { name: string; _id: string; listId: string; type: string }[],
    },
    media: {
      list: [
        {
          id: "media-1",
          name: "Sunrise Image",
          type: "image",
          thumbnail: "https://example.com/thumb.jpg",
          background: "https://example.com/bg.jpg",
          source: "cloudinary",
          format: "",
          path: "",
          createdAt: "",
          updatedAt: "",
          height: 0,
          width: 0,
          publicId: "",
        },
      ],
      folders: [],
      isInitialized: true,
      loadStatus: "ready",
    },
    undoable: {
      present: {
        item: {
          isLoading: false,
          type: "song",
          selectedArrangement: 0,
          selectedSlide: 0,
          arrangements: [],
          slides: [
            {
              id: "slide-1",
              type: "Verse",
              name: "V1",
              boxes: [],
            },
          ],
          backgroundTargetSlideIds: [],
          backgroundTargetRangeAnchorId: null,
          mobileBackgroundTargetSelectMode: false,
        },
        overlay: {
          selectedOverlay: null,
        },
        preferences: {
          isMediaExpanded: true,
          mediaItemsPerRow: 4,
          selectedPreference: null,
          selectedQuickLink: null,
          mediaRouteFolders: {},
          preferences: {
            defaultFreeFormBackgroundBrightness: 100,
            defaultFreeFormFontMode: "separate",
          },
        },
      },
    },
  };

  return {
    ...base,
    ...overrides,
    presentation: {
      ...base.presentation,
      ...((overrides as any).presentation || {}),
    },
    allItems: {
      ...base.allItems,
      ...((overrides as any).allItems || {}),
    },
    media: {
      ...base.media,
      ...(overrides as any).media,
    },
    undoable: {
      ...base.undoable,
      ...(overrides as any).undoable,
      present: {
        ...base.undoable.present,
        ...((overrides as any).undoable?.present || {}),
        item: {
          ...base.undoable.present.item,
          ...((overrides as any).undoable?.present?.item || {}),
        },
        overlay: {
          ...base.undoable.present.overlay,
          ...((overrides as any).undoable?.present?.overlay || {}),
        },
        preferences: {
          ...base.undoable.present.preferences,
          ...((overrides as any).undoable?.present?.preferences || {}),
        },
      },
    },
  };
};

/** In jsdom the action row is often too narrow, so route actions sit in the overflow menu. */
async function clickMediaLibraryRouteAction(name: RegExp) {
  const user = userEvent.setup();
  const more = screen.queryByRole("button", { name: /More actions/i });
  if (more) {
    await user.click(more);
    const item = await screen.findByRole("menuitem", { name });
    await user.click(item);
    return;
  }
  await user.click(screen.getByRole("button", { name }));
}

const renderMedia = async ({
  isMobile = false,
  isGuestSession = false,
  churchId = "church-1",
  dbOverride,
}: {
  isMobile?: boolean;
  isGuestSession?: boolean;
  churchId?: string;
  dbOverride?: Record<string, unknown>;
} = {}) => {
  const db = dbOverride ?? {
    get: jest.fn().mockResolvedValue({ list: [], folders: [] }),
    allDocs: jest.fn().mockResolvedValue({ rows: [] }),
  };
  const cloud = { image: jest.fn(), video: jest.fn() };
  const updater = new EventTarget();

  const renderAtScope = (scopeDb: Record<string, unknown>, scopeChurchId: string) => (
    <ControllerInfoContext.Provider
      value={
        {
          db: scopeDb,
          cloud,
          updater,
          isMobile,
          isGuestSession,
        } as any
      }
    >
      <GlobalInfoContext.Provider value={{ churchId: scopeChurchId } as any}>
        <Media />
      </GlobalInfoContext.Provider>
    </ControllerInfoContext.Provider>
  );
  const view = render(renderAtScope(db, churchId));

  await waitFor(() => {
    expect(mockGetCanvaStatus).toHaveBeenCalled();
  });
  const statusResult = mockGetCanvaStatus.mock.results.at(-1)?.value;
  if (statusResult) {
    await act(async () => {
      await statusResult.catch(() => undefined);
    });
  }

  return {
    db,
    view,
    rerenderScope: (scopeDb: Record<string, unknown>, scopeChurchId: string) =>
      view.rerender(renderAtScope(scopeDb, scopeChurchId)),
  };
};

describe("Media", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateTransfer.mockClear();
    mockTransfers.clear();
    mockTransferActionHandlers.clear();
    mockFlushMediaLibraryDocToPouch.mockResolvedValue({ ok: true });
    mockRepairPersistedMediaRouteFolders.mockResolvedValue([]);
    mockBroadcastRouteFolderDocs.mockClear();
    mockBroadcastTarget = { postMessage: jest.fn() };
    mockDeleteMediaItemsFromPouch.mockImplementation(async (_db, ids: string[]) => ({
      deletedIds: ids,
      failed: [],
    }));
    mockDeleteMediaItemAtRevisionFromPouch.mockResolvedValue("deleted");
    mockSweepMediaReferencesBeforeDelete.mockResolvedValue({
      ok: true,
      failedDocIds: [],
      rollback: jest.fn().mockResolvedValue("complete"),
    });
    mockReadMediaItemForDeletion.mockImplementation(async (_db, id: string) => {
      const item = mockState.media.list.find((row: { id: string }) => row.id === id);
      return item ? {
        item,
        doc: { ...item, _id: `media-item:${id}`, _rev: "1-current", docType: "mediaItem" },
      } : null;
    });
    mockDeleteCloudinaryMediaAsset.mockResolvedValue(undefined);
    mockDeleteMuxAsset.mockResolvedValue(undefined);
    mockShowToast.mockReturnValue("delete-toast");
    mockSelectedMediaIds = new Set();
    mockNavigate.mockClear();
    mockShowToast.mockClear();
    mockUseLocation.mockReturnValue({ pathname: "/item/123" });
    mockState = makeBaseState();
    mockSelectedMedia = { ...emptySelectedMedia };
    mockSelectedMediaIds = new Set();
    mockGetCanvaStatus.mockResolvedValue({
      oauthConfigured: true,
      connected: true,
      accountLabel: "Church Canva",
    });
  });

  it("keeps panel sizing tied to the expanded state", () => {
    const collapsedClassName = getMediaPanelClassName({
      isPanelVariant: true,
      isMediaExpanded: false,
    });
    const expandedClassName = getMediaPanelClassName({
      isPanelVariant: true,
      isMediaExpanded: true,
    });

    expect(collapsedClassName).toContain("shrink-0");
    expect(collapsedClassName).toContain("mt-auto");
    expect(collapsedClassName).not.toContain("h-full");
    expect(expandedClassName).toContain("flex-1");
    expect(expandedClassName).not.toContain("h-full");
    expect(
      getMediaPanelClassName({
        isPanelVariant: false,
        isMediaExpanded: false,
      }),
    ).toBe("contents");
  });

  it("renders media from store and sets media items per row", async () => {
    await renderMedia({ isMobile: false });

    expect(
      screen.getByRole("heading", { name: "Sources" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse Sources" }),
    ).toHaveAttribute("title", "Collapse Sources");
    await waitFor(() => {
      expect(mockSetMediaItems).toHaveBeenCalledWith(4);
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "preferences/setMediaItems",
      payload: 4,
    });
    expect(screen.getByText("All media")).toBeInTheDocument();
  });

  it("uses mobile media grid defaults when running on mobile", async () => {
    await renderMedia({ isMobile: true });

    expect(mockSetMediaItems).toHaveBeenCalledWith(3);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "preferences/setMediaItems",
      payload: 3,
    });
  });

  it("offers a source filter for every supported origin", async () => {
    const user = userEvent.setup();
    await renderMedia();

    const sourceFilter = screen.getByRole("combobox", { name: /source/i });
    expect(sourceFilter).toHaveTextContent("All sources");

    await user.click(sourceFilter);
    expect(
      await screen.findByRole("option", { name: "Local" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Video inputs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Canva" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Uploaded" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /Other devices/i }),
    ).not.toBeInTheDocument();
  });

  it("registers a media-created presentation in the Custom library", async () => {
    const mediaItem = makeBaseState().media.list[0];
    mockSelectedMediaIds = new Set([mediaItem.id]);
    mockSelectedMedia = { ...mediaItem, source: "cloudinary" as const };
    mockCreateNewFreeForm.mockResolvedValue({
      _id: "media-presentation",
      name: "Sunrise Image",
      type: "free",
      background: "https://example.com/bg.jpg",
      slides: [],
      arrangements: [],
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 1,
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } as Awaited<ReturnType<typeof createNewFreeForm>>);
    await renderMedia();

    await clickMediaLibraryRouteAction(/Create custom item/i);

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        upsertItemInAllItemsList({
          _id: "media-presentation",
          name: "Sunrise Image",
          type: "free",
          background: "https://example.com/bg.jpg",
          listId: "",
        }),
      );
    });
  });

  it("hides other-device local files until Other devices is turned on", async () => {
    mockState = makeBaseState({
      media: {
        list: [
          {
            id: "media-1",
            name: "Sunrise Image",
            type: "image",
            thumbnail: "https://example.com/thumb.jpg",
            background: "https://example.com/bg.jpg",
            source: "cloudinary",
            format: "",
            path: "",
            createdAt: "",
            updatedAt: "",
            height: 0,
            width: 0,
            publicId: "",
          },
          {
            id: "remote-local",
            name: "Booth slide",
            type: "image",
            thumbnail: "",
            background: "local-image://remote-local",
            source: "local",
            format: "png",
            path: "",
            createdAt: "",
            updatedAt: "",
            height: 1080,
            width: 1920,
            publicId: "remote-local",
            localImage: {
              id: "remote-local",
              ownerDeviceId: "other-device",
              ownerLabel: "Booth PC",
              fileName: "Booth slide.png",
              contentType: "image/png",
              storagePolicy: "local-only",
            },
          },
        ],
        folders: [],
        isInitialized: true,
        loadStatus: "ready",
      },
    });
    const user = userEvent.setup();
    await renderMedia();

    const toggle = screen.getByRole("switch", { name: /Other devices/i });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(toggle).toBeChecked();
  });

  it("opens the add-media menu and adds files from this device", async () => {
    const user = userEvent.setup();
    await renderMedia();

    await user.click(screen.getByTitle("Add Media"));
    await waitFor(() => {
      expect(
        screen.getByRole("menuitem", { name: /import from canva/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("menuitem", { name: /add files/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /add video input/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /add files/i }));
    expect(mockOpenModal).toHaveBeenCalledTimes(1);
  });

  it("hides Canva import when Canva OAuth is not configured", async () => {
    mockGetCanvaStatus.mockResolvedValue({
      oauthConfigured: false,
      connected: false,
      accountLabel: "",
    });
    const user = userEvent.setup();
    await renderMedia();

    await user.click(screen.getByTitle("Add Media"));
    expect(
      screen.getByRole("menuitem", { name: /add files/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetCanvaStatus).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("menuitem", { name: /import from canva/i }),
    ).not.toBeInTheDocument();
  });

  it("logs a failed Canva status request while keeping import hidden", async () => {
    const error = new Error("Request failed");
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockGetCanvaStatus.mockRejectedValue(error);

    await renderMedia();

    expect(warn).toHaveBeenCalledWith("Could not load Canva status.", error);
    expect(
      screen.queryByRole("menuitem", { name: /import from canva/i }),
    ).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it("does not allow guests to open Canva import from the panel menu", async () => {
    const user = userEvent.setup();
    await renderMedia({ isGuestSession: true });

    await user.click(screen.getByTitle("Add Media"));
    const importItem = await screen.findByRole("menuitem", {
      name: /import from canva/i,
    });
    expect(importItem).toHaveAttribute("data-disabled");
    await user.click(importItem);
    expect(
      screen.queryByRole("heading", { name: /import from canva/i }),
    ).not.toBeInTheDocument();
  });

  it("disables media entry points until the library is initialized", async () => {
    mockState = makeBaseState({
      media: {
        list: [],
        folders: [],
        isInitialized: false,
        loadStatus: "loading",
      },
    });
    await renderMedia();

    expect(screen.getByTitle("Add Media")).toBeDisabled();
    expect(screen.getByTitle("Fullscreen")).toBeDisabled();
    fireEvent.click(screen.getByTitle("Add Media"));
    expect(mockOpenModal).not.toHaveBeenCalled();
  });

  it("keeps media read-only and shows recovery guidance after a load error", async () => {
    mockState = makeBaseState({
      media: {
        list: [],
        folders: [],
        isInitialized: false,
        loadStatus: "error",
      },
    });
    await renderMedia();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Media is unavailable.")).toBeInTheDocument();
    expect(
      screen.getByText("Reload the page before making media changes."),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Add Media")).toBeDisabled();
    expect(screen.getByTitle("Fullscreen")).toBeDisabled();
    expect(screen.queryByText("Loading media...")).not.toBeInTheDocument();
  });

  it("does not clear selection when opening the More actions overflow menu", async () => {
    mockUseLocation.mockReturnValue({ pathname: "/preferences/quick-links" });
    mockState = makeBaseState({
      undoable: {
        present: {
          preferences: {
            selectedQuickLink: { linkType: "media" },
          },
        },
      },
    });
    const listItem = makeBaseState().media.list[0];
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...listItem, source: "cloudinary" as const };
    await renderMedia();

    const more = screen.queryByRole("button", { name: /More actions/i });
    if (!more) {
      // Wide layout: actions are inline, no overflow trigger.
      return;
    }

    const user = userEvent.setup();
    await user.click(more);

    expect(mockClearSelection).not.toHaveBeenCalled();
  });

  it("keeps the rename popover open from the action menu", async () => {
    const listItem = makeBaseState().media.list[0];
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...listItem, source: "cloudinary" as const };
    await renderMedia();

    const user = userEvent.setup();
    const more = screen.queryByRole("button", { name: /More actions/i });
    if (more) {
      await user.click(more);
      await user.click(
        await screen.findByRole("menuitem", { name: /Rename/i }),
      );
    } else {
      await user.click(screen.getByRole("button", { name: /^Rename$/i }));
    }

    const renameInput = await screen.findByLabelText(/Display name/i);
    await waitFor(() => expect(renameInput).toBeVisible());

    await user.type(renameInput, " updated");

    expect(renameInput).toHaveValue("Sunrise Image updated");
  });

  it("dispatches quick-link media background action from action bar", async () => {
    mockUseLocation.mockReturnValue({ pathname: "/preferences/quick-links" });
    mockState = makeBaseState({
      undoable: {
        present: {
          preferences: {
            selectedQuickLink: { linkType: "media" },
          },
        },
      },
    });
    const listItem = makeBaseState().media.list[0];
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...listItem, source: "cloudinary" as const };
    await renderMedia();

    await clickMediaLibraryRouteAction(/Set Quick Link Background/i);

    expect(mockSetSelectedQuickLinkImage).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preferences/setSelectedQuickLinkImage",
      }),
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      'Set quick link background to "Sunrise Image".',
      "success",
    );
  });

  it("dispatches overlay image actions from overlays route action bar", async () => {
    mockUseLocation.mockReturnValue({ pathname: "/overlays" });
    mockState = makeBaseState({
      undoable: {
        present: {
          overlay: {
            selectedOverlay: { id: "overlay-1", type: "image" },
          },
        },
      },
    });
    const listItem = makeBaseState().media.list[0];
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...listItem, source: "cloudinary" as const };
    await renderMedia();

    await clickMediaLibraryRouteAction(/Set Image Overlay/i);

    expect(mockUpdateOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ id: "overlay-1" }),
    );
    expect(mockUpdateOverlayInList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "overlay-1" }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "overlay/updateOverlay" }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "overlays/updateOverlayInList" }),
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      'Set overlay image to "Sunrise Image".',
      "success",
    );
  });

  it("dispatches projector update when Send to projector is used and transmitting is on", async () => {
    mockState = makeBaseState({
      presentation: fromLegacyPresentationShape({
        isProjectorTransmitting: true,
      }),
    });
    const listItem = makeBaseState().media.list[0];
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...listItem, source: "cloudinary" as const };
    await renderMedia();

    await clickMediaLibraryRouteAction(/Send to projector/i);

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "presentation/updateProjector",
        payload: expect.objectContaining({
          type: "free",
          name: "Sunrise Image",
          // Named explicitly: an unnamed send falls back to the built-in
          // projector, which put auxiliary-controller media on the sanctuary
          // screen.
          outputIds: ["projector"],
          slide: expect.objectContaining({
            type: "Section",
            name: "Section 1",
          }),
        }),
      }),
    );
    // The display's own name, not the word "projector" — a controller whose
    // screen is called "TVs" should say so.
    expect(mockShowToast).toHaveBeenCalledWith(
      'Sent "Sunrise Image" to Projector.',
      "success",
    );
  });

  it("persists an item tombstone before provider cleanup and keeps library deletion on provider failure", async () => {
    mockState = makeBaseState();
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = {
      ...mockState.media.list[0],
      source: "cloudinary" as const,
    };
    mockDeleteCloudinaryMediaAsset.mockRejectedValueOnce(new Error("provider unavailable"));
    await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: "confirm-delete" }),
    );

    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalled());
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: "media-item:media-1", _rev: "1-current" }),
    );
    expect(mockDeleteMediaItemAtRevisionFromPouch.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteCloudinaryMediaAsset.mock.invocationCallOrder[0],
    );
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "media/removeMediaItemFromRemote",
      payload: "media-1",
    });
    await waitFor(() => expect(mockUpdateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Media deletion",
        status: "partial",
        detail: "1 of 1 removed · 1 need attention",
        files: expect.arrayContaining([
          expect.objectContaining({ id: "media-1", status: "complete", progress: 100, phase: "Cloud cleanup failed" }),
        ]),
        actions: expect.arrayContaining([expect.objectContaining({ key: "retry-cleanup" })]),
      }),
    ));
    const activityId = mockUpdateTransfer.mock.calls.at(-1)?.[0]?.id;
    const retryCleanup = mockTransferActionHandlers.get(`${activityId}:retry-cleanup`);
    expect(retryCleanup).toBeDefined();
    await act(async () => { await retryCleanup?.(); });
    await waitFor(() => {
      const activity = mockUpdateTransfer.mock.calls
        .map(([transfer]) => transfer)
        .filter((transfer) => transfer.id === activityId)
        .at(-1);
      expect(activity).toEqual(expect.objectContaining({ type: "Media deletion", status: "complete" }));
    });
  });

  it("keeps a committed deletion owned by Church A when the same media ID appears in Church B", async () => {
    mockState = makeBaseState();
    mockState.media.list[0] = { ...mockState.media.list[0], publicId: "church-a-asset" };
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...mockState.media.list[0], source: "cloudinary" as const };
    let resolveTombstone!: (result: "deleted") => void;
    mockDeleteMediaItemAtRevisionFromPouch.mockReturnValueOnce(new Promise((resolve) => { resolveTombstone = resolve; }));
    const { db: dbA, view } = await renderMedia({ churchId: "church-A" });

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));
    await waitFor(() => expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledWith(
      dbA,
      expect.objectContaining({ id: "media-1", publicId: "church-a-asset" }),
    ));
    const activityId = mockUpdateTransfer.mock.calls.at(-1)![0].id;

    const churchBMedia = {
      ...makeBaseState().media.list[0],
      id: "media-1",
      name: "Church B image",
      publicId: "church-b-asset",
    };
    mockState = makeBaseState({ media: { list: [churchBMedia], folders: [] } });
    const dbB = {
      get: jest.fn().mockResolvedValue({ list: [], folders: [] }),
      allDocs: jest.fn().mockResolvedValue({ rows: [] }),
    };
    view.rerender(
      <ControllerInfoContext.Provider value={{
        db: dbB,
        cloud: { image: jest.fn(), video: jest.fn() },
        updater: new EventTarget(),
        isMobile: false,
        isGuestSession: false,
      } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-B" } as any}>
          <Media />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );
    const dispatchCountBeforeCommit = mockDispatch.mock.calls.length;

    await act(async () => { resolveTombstone("deleted"); });

    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith(
      "church-A",
      "church-a-asset",
    ));
    expect(mockDeleteCloudinaryMediaAsset).not.toHaveBeenCalledWith("church-B", "church-b-asset");
    expect(mockSweepMediaReferencesBeforeDelete.mock.results[0]?.value).toBeDefined();
    const sweep = await mockSweepMediaReferencesBeforeDelete.mock.results[0]!.value;
    expect(sweep.rollback).not.toHaveBeenCalled();
    expect(mockDispatch.mock.calls.slice(dispatchCountBeforeCommit)).not.toContainEqual([
      { type: "media/removeMediaItemFromRemote", payload: "media-1" },
    ]);
    expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "complete",
      files: expect.arrayContaining([expect.objectContaining({ id: "media-1", status: "complete" })]),
    }));
  });

  it("uses the authoritative persisted row when the delete modal target is stale", async () => {
    mockState = makeBaseState();
    const staleRow = { ...mockState.media.list[0], publicId: "old-provider-id" };
    const persistedRow = { ...staleRow, name: "Latest", publicId: "latest-provider-id" };
    mockState.media.list = [staleRow];
    mockSelectedMediaIds = new Set([staleRow.id]);
    mockSelectedMedia = { ...staleRow, source: "cloudinary" as const };
    await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    mockReadMediaItemForDeletion.mockResolvedValueOnce({
      item: persistedRow,
      doc: {
        ...persistedRow,
        _id: `media-item:${persistedRow.id}`,
        _rev: "2-latest",
        docType: "mediaItem",
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));

    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith(
      expect.anything(),
      "latest-provider-id",
    ));
    expect(mockDeleteCloudinaryMediaAsset).not.toHaveBeenCalledWith(
      expect.anything(),
      "old-provider-id",
    );
    expect(mockSweepMediaReferencesBeforeDelete).toHaveBeenCalledWith(
      expect.anything(),
      new Set([persistedRow.id]),
      [persistedRow],
    );
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _rev: "2-latest", publicId: "latest-provider-id" }),
    );
  });

  it("rolls back a successful sweep before retrying a revision conflict", async () => {
    mockState = makeBaseState();
    const revisionA = { ...mockState.media.list[0], background: "https://cdn/a.png", publicId: "provider-a" };
    const revisionB = { ...revisionA, background: "https://cdn/b.png", publicId: "provider-b" };
    mockState.media.list = [revisionA];
    mockSelectedMediaIds = new Set([revisionA.id]);
    mockSelectedMedia = { ...revisionA, source: "cloudinary" as const };
    const rollback = jest.fn().mockResolvedValue("complete");
    mockReadMediaItemForDeletion
      .mockResolvedValueOnce({ item: revisionA, doc: { ...revisionA, _id: `media-item:${revisionA.id}`, _rev: "4-a", docType: "mediaItem" } })
      .mockResolvedValueOnce({ item: revisionB, doc: { ...revisionB, _id: `media-item:${revisionB.id}`, _rev: "5-b", docType: "mediaItem" } });
    mockSweepMediaReferencesBeforeDelete
      .mockResolvedValueOnce({ ok: true, failedDocIds: [], rollback })
      .mockResolvedValueOnce({ ok: true, failedDocIds: [], rollback: jest.fn().mockResolvedValue("complete") });
    mockDeleteMediaItemAtRevisionFromPouch
      .mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }))
      .mockResolvedValueOnce("deleted");
    await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));

    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith(
      expect.anything(),
      "provider-b",
    ));
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mockSweepMediaReferencesBeforeDelete.mock.calls.map(([, , rows]) => rows[0].publicId))
      .toEqual(["provider-a", "provider-b"]);
    expect(mockDeleteMediaItemAtRevisionFromPouch.mock.calls.map(([, doc]) => doc._rev))
      .toEqual(["4-a", "5-b"]);
    expect(rollback.mock.invocationCallOrder[0]).toBeLessThan(
      mockReadMediaItemForDeletion.mock.invocationCallOrder[1],
    );
  });

  it("does not remove provider assets or Redux rows when an item tombstone fails", async () => {
    mockState = makeBaseState();
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...mockState.media.list[0], source: "cloudinary" as const };
    mockDeleteMediaItemAtRevisionFromPouch.mockRejectedValue(new Error("disk unavailable"));
    const rollback = jest.fn().mockResolvedValue("complete");
    mockSweepMediaReferencesBeforeDelete.mockResolvedValue({
      ok: true,
      failedDocIds: [],
      rollback,
    });
    await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));

    await waitFor(() => expect(mockUpdateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Media deletion",
        status: "failed",
        files: expect.arrayContaining([
          expect.objectContaining({ id: "media-1", status: "failed", phase: "Media removal failed" }),
        ]),
        actions: expect.arrayContaining([expect.objectContaining({ key: "retry-delete" })]),
      }),
    ));
    expect(mockDeleteCloudinaryMediaAsset).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalledWith({
      type: "media/removeMediaItemFromRemote",
      payload: "media-1",
    });
  });

  it("retires route-owned deletion actions but keeps Media Activity dismissible after unmount", async () => {
    mockState = makeBaseState();
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...mockState.media.list[0], source: "cloudinary" as const };
    let rejectDelete!: (error: Error) => void;
    mockDeleteMediaItemAtRevisionFromPouch.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectDelete = reject; }));
    const user = userEvent.setup();
    const { view } = await renderMedia();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "confirm-delete" }));
    await waitFor(() => expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalled());
    const transferId = mockUpdateTransfer.mock.calls[0]?.[0]?.id ?? "";
    expect(transferId).toBeTruthy();

    view.unmount();
    const terminalTransfer = mockGetTransfer(transferId);
    expect(terminalTransfer.status).toBe("failed");
    expect(terminalTransfer.actions).toEqual([{ key: "dismiss", label: "Dismiss" }]);
    expect(mockTransferActionHandlers.has(`${transferId}:retry-delete`)).toBe(false);
    expect(mockTransferActionHandlers.has(`${transferId}:dismiss`)).toBe(true);

    await act(async () => { rejectDelete(new Error("disk unavailable after unmount")); });
    expect(mockDeleteCloudinaryMediaAsset).not.toHaveBeenCalled();
    expect(mockGetTransfer(transferId).actions).toEqual([{ key: "dismiss", label: "Dismiss" }]);
    await act(async () => { await mockTransferActionHandlers.get(`${transferId}:dismiss`)?.(); });
    expect(mockRemoveTransfer).toHaveBeenCalledWith(transferId);
  });

  it("publishes deletion success and keeps Dismiss after Media unmounts during provider cleanup", async () => {
    mockState = makeBaseState();
    mockState.media.list[0] = { ...mockState.media.list[0], publicId: "sunrise-image" };
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...mockState.media.list[0], source: "cloudinary" as const };
    let resolveProviderCleanup!: () => void;
    mockDeleteCloudinaryMediaAsset.mockReturnValueOnce(new Promise<void>((resolve) => { resolveProviderCleanup = resolve; }));
    const { view } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));
    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith("church-1", "sunrise-image"));
    const activityId = mockUpdateTransfer.mock.calls.at(-1)![0].id;
    view.unmount();
    const dispatchCountAfterUnmount = mockDispatch.mock.calls.length;

    await act(async () => { resolveProviderCleanup(); });

    expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "complete",
      phase: expect.objectContaining({ label: "Deletion complete" }),
      actions: [{ key: "dismiss", label: "Dismiss" }],
    }));
    expect(mockDispatch).toHaveBeenCalledTimes(dispatchCountAfterUnmount);
    expect(mockTransferActionHandlers.has(`${activityId}:dismiss`)).toBe(true);
    await act(async () => { await mockTransferActionHandlers.get(`${activityId}:dismiss`)?.(); });
    expect(mockRemoveTransfer).toHaveBeenCalledWith(activityId);
  });

  it("keeps a dismissed detached Activity hidden when provider cleanup later succeeds", async () => {
    mockState = makeBaseState();
    mockState.media.list[0] = { ...mockState.media.list[0], publicId: "sunrise-image" };
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...mockState.media.list[0], source: "cloudinary" as const };
    let resolveProviderCleanup!: () => void;
    mockDeleteCloudinaryMediaAsset.mockReturnValueOnce(new Promise<void>((resolve) => { resolveProviderCleanup = resolve; }));
    const { view } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));
    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith("church-1", "sunrise-image"));
    const activityId = mockUpdateTransfer.mock.calls.at(-1)![0].id;
    view.unmount();
    const dismiss = mockTransferActionHandlers.get(`${activityId}:dismiss`);
    expect(dismiss).toBeDefined();
    await act(async () => { await dismiss?.(); });
    expect(mockGetTransfer(activityId)).toBeUndefined();

    await act(async () => { resolveProviderCleanup(); });

    expect(mockGetTransfer(activityId)).toBeUndefined();
    expect(mockTransferActionHandlers.has(`${activityId}:dismiss`)).toBe(false);
    expect(mockTransferActionHandlers.has(`${activityId}:retry-cleanup`)).toBe(false);
  });

  it("makes late provider cleanup failure retryable after Media unmounts", async () => {
    mockState = makeBaseState();
    mockState.media.list[0] = { ...mockState.media.list[0], publicId: "sunrise-image" };
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...mockState.media.list[0], source: "cloudinary" as const };
    let rejectProviderCleanup!: (error: Error) => void;
    mockDeleteCloudinaryMediaAsset
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectProviderCleanup = reject; }))
      .mockResolvedValueOnce(undefined);
    const { view } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));
    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith("church-1", "sunrise-image"));
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledTimes(1);
    const activityId = mockUpdateTransfer.mock.calls.at(-1)![0].id;
    view.unmount();
    const dispatchCountAfterUnmount = mockDispatch.mock.calls.length;

    await act(async () => { rejectProviderCleanup(new Error("provider unavailable")); });
    await waitFor(() => expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "partial",
      phase: expect.objectContaining({ label: "Media removed; cloud cleanup needs attention" }),
      actions: expect.arrayContaining([
        { key: "retry-cleanup", label: "Retry cleanup" },
        { key: "dismiss", label: "Dismiss" },
      ]),
    })));
    expect(mockTransferActionHandlers.has(`${activityId}:retry-delete`)).toBe(false);
    expect(mockTransferActionHandlers.has(`${activityId}:retry-cleanup`)).toBe(true);

    await act(async () => { await mockTransferActionHandlers.get(`${activityId}:retry-cleanup`)?.(); });

    expect(mockDeleteCloudinaryMediaAsset).toHaveBeenLastCalledWith("church-1", "sunrise-image");
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledTimes(1);
    expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "complete",
      actions: [{ key: "dismiss", label: "Dismiss" }],
    }));
    expect(mockDispatch).toHaveBeenCalledTimes(dispatchCountAfterUnmount);
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => { await mockTransferActionHandlers.get(`${activityId}:dismiss`)?.(); });
    expect(mockRemoveTransfer).toHaveBeenCalledWith(activityId);
  });

  it("resurfaces cleanup failure after dismissal and stays dismissed after retry succeeds", async () => {
    mockState = makeBaseState();
    mockState.media.list[0] = { ...mockState.media.list[0], publicId: "sunrise-image" };
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...mockState.media.list[0], source: "cloudinary" as const };
    let rejectProviderCleanup!: (error: Error) => void;
    mockDeleteCloudinaryMediaAsset
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectProviderCleanup = reject; }))
      .mockResolvedValueOnce(undefined);
    const { view } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));
    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith("church-1", "sunrise-image"));
    const activityId = mockUpdateTransfer.mock.calls.at(-1)![0].id;
    view.unmount();
    const dismiss = mockTransferActionHandlers.get(`${activityId}:dismiss`);
    expect(dismiss).toBeDefined();
    await act(async () => { await dismiss?.(); });
    expect(mockGetTransfer(activityId)).toBeUndefined();

    await act(async () => { rejectProviderCleanup(new Error("provider unavailable")); });
    await waitFor(() => expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "partial",
      actions: [
        { key: "retry-cleanup", label: "Retry cleanup" },
        { key: "dismiss", label: "Dismiss" },
      ],
    })));
    const retryCleanup = mockTransferActionHandlers.get(`${activityId}:retry-cleanup`);
    expect(retryCleanup).toBeDefined();
    await act(async () => { await retryCleanup?.(); });
    expect(mockDeleteCloudinaryMediaAsset).toHaveBeenLastCalledWith("church-1", "sunrise-image");
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledTimes(1);
    expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "complete",
      actions: [{ key: "dismiss", label: "Dismiss" }],
    }));

    const dismissAgain = mockTransferActionHandlers.get(`${activityId}:dismiss`);
    expect(dismissAgain).toBeDefined();
    await act(async () => { await dismissAgain?.(); });
    expect(mockGetTransfer(activityId)).toBeUndefined();
    expect(mockTransferActionHandlers.has(`${activityId}:dismiss`)).toBe(false);
    expect(mockTransferActionHandlers.has(`${activityId}:retry-cleanup`)).toBe(false);
  });

  it("exposes late folder provider cleanup failure through detached Activity retry", async () => {
    const mediaRow = {
      ...makeBaseState().media.list[0],
      id: "folder-cloud-media",
      name: "Folder image",
      folderId: "folder-1",
      source: "cloudinary" as const,
      publicId: "folder-cloud-asset",
    };
    mockState = makeBaseState({
      media: { list: [mediaRow], folders: [{ id: "folder-1", name: "Sermon slides", parentId: null }] },
    });
    mockState.undoable.present.preferences.mediaRouteFolders = { "controller-default": "folder-1" };
    mockState.undoable.present.preferences.mediaRouteFoldersControllerProfileId = "presentation";
    let rejectProviderCleanup!: (error: Error) => void;
    mockDeleteCloudinaryMediaAsset
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectProviderCleanup = reject; }))
      .mockResolvedValueOnce(undefined);
    const { view } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await userEvent.click(screen.getByRole("radio", { name: "Delete folder and contents" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith("church-1", "folder-cloud-asset"));
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledTimes(1);
    const activityId = mockUpdateTransfer.mock.calls.at(-1)![0].id;
    view.unmount();
    const dispatchCountAfterUnmount = mockDispatch.mock.calls.length;

    await act(async () => { rejectProviderCleanup(new Error("provider unavailable")); });
    await waitFor(() => expect(mockGetTransfer(activityId)?.actions).toEqual(expect.arrayContaining([
      { key: "retry-cleanup", label: "Retry cleanup" },
      { key: "dismiss", label: "Dismiss" },
    ])));
    await act(async () => { await mockTransferActionHandlers.get(`${activityId}:retry-cleanup`)?.(); });

    expect(mockDeleteCloudinaryMediaAsset).toHaveBeenLastCalledWith("church-1", "folder-cloud-asset");
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledTimes(1);
    expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "complete",
      actions: [{ key: "dismiss", label: "Dismiss" }],
    }));
    expect(mockFlushMediaLibraryDocToPouch).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledTimes(dispatchCountAfterUnmount);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("finishes keep-contents persistence for A without publishing A state after switching to B", async () => {
    const mediaA = { ...makeBaseState().media.list[0], id: "same-media", name: "A image", folderId: "same-folder" };
    const foldersA = [{ id: "same-folder", name: "A folder", parentId: null }];
    mockState = makeBaseState({ media: { list: [mediaA], folders: foldersA } });
    mockState.undoable.present.preferences.mediaRouteFolders = { "controller-default": "same-folder" };
    mockState.undoable.present.preferences.mediaRouteFoldersControllerProfileId = "presentation";
    const repair = deferred<any[]>();
    mockRepairPersistedMediaRouteFolders.mockReturnValueOnce(repair.promise);
    const { db: dbA, rerenderScope } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await userEvent.click(screen.getByRole("radio", { name: "Delete folder but keep contents" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(mockRepairPersistedMediaRouteFolders).toHaveBeenCalledWith(dbA, new Set(["same-folder"]), MEDIA_LIBRARY_ROOT_VIEW));

    const mediaB = { ...mediaA, name: "B image" };
    const foldersB = [{ id: "same-folder", name: "B folder", parentId: null }];
    mockState = makeBaseState({ media: { list: [mediaB], folders: foldersB } });
    const dbB = { allDocs: jest.fn(), put: jest.fn() };
    mockBroadcastTarget = { postMessage: jest.fn() };
    rerenderScope(dbB, "church-2");
    const dispatchCountAtB = mockDispatch.mock.calls.length;
    const navigationCountAtB = mockNavigate.mock.calls.length;

    await act(async () => {
      repair.resolve([{ _id: "mediaRouteFolders:presentation", mediaRouteFolders: { "controller-default": "root" } }]);
      await repair.promise;
    });

    expect(mockBroadcastTarget.postMessage).not.toHaveBeenCalled();
    expect(mockDispatch.mock.calls.slice(dispatchCountAtB).map(([action]) => action.type)).not.toContain("preferences/repairActiveMediaRouteFolders");
    expect(mockDispatch.mock.calls.slice(dispatchCountAtB).map(([action]) => action.type)).not.toContain("preferences/setMediaRouteFolder");
    expect(mockDispatch.mock.calls.slice(dispatchCountAtB).map(([action]) => action.payload)).not.toContainEqual(expect.objectContaining({
      list: expect.arrayContaining([expect.objectContaining({ name: "A image" })]),
    }));
    expect(mockNavigate).toHaveBeenCalledTimes(navigationCountAtB);
    expect(mockFlushMediaLibraryDocToPouch).toHaveBeenCalledWith(
      dbA,
      expect.arrayContaining([expect.objectContaining({ id: "same-media", name: "A image", folderId: null })]),
      [],
      expect.any(Function),
      expect.objectContaining({ list: [mediaA], folders: foldersA }),
      expect.objectContaining({
        allowOriginalOwnerPersistenceAfterScopeChange: true,
        publishIfCurrent: expect.any(Function),
      }),
    );
    await act(async () => {
      await mockFlushMediaLibraryDocToPouch.mock.results.at(-1)?.value;
    });
    expect(dbB.allDocs).not.toHaveBeenCalled();
    expect(dbB.put).not.toHaveBeenCalled();
  });

  it("keeps same-church keep-contents Redux, route broadcast, and persistence behavior", async () => {
    const media = { ...makeBaseState().media.list[0], id: "kept-media", folderId: "folder-1" };
    const folders = [{ id: "folder-1", name: "Sermon slides", parentId: null }];
    mockState = makeBaseState({ media: { list: [media], folders } });
    mockState.undoable.present.preferences.mediaRouteFolders = { "controller-default": "folder-1" };
    mockState.undoable.present.preferences.mediaRouteFoldersControllerProfileId = "presentation";
    const docs = [{ _id: "mediaRouteFolders:presentation", controllerProfileId: "presentation", mediaRouteFolders: { "controller-default": MEDIA_LIBRARY_ROOT_VIEW } }];
    mockRepairPersistedMediaRouteFolders.mockResolvedValueOnce(docs);
    const { db } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await userEvent.click(screen.getByRole("radio", { name: "Delete folder but keep contents" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));

    await waitFor(() => expect(mockFlushMediaLibraryDocToPouch).toHaveBeenCalledWith(
      db,
      [expect.objectContaining({ id: "kept-media", folderId: null })],
      [],
      expect.any(Function),
      expect.objectContaining({ list: [media], folders }),
      expect.objectContaining({ allowOriginalOwnerPersistenceAfterScopeChange: true }),
    ));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "media/setMediaListAndFolders",
      payload: expect.objectContaining({
        list: [expect.objectContaining({ id: "kept-media", folderId: null })],
        folders: [],
      }),
    }));
    expect(mockBroadcastTarget.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "update",
      data: expect.objectContaining({ docs }),
    }));
  });

  it("keeps concurrent media changes when keep-contents finalization resumes", async () => {
    const baseMedia = makeBaseState().media.list[0];
    const original = { ...baseMedia, id: "kept-media", name: "Original name", folderId: "folder-1" };
    const removedBeforeFinalize = { ...baseMedia, id: "removed-before-finalize", folderId: null };
    const folders = [{ id: "folder-1", name: "Sermon slides", parentId: null }];
    mockState = makeBaseState({ media: { list: [original, removedBeforeFinalize], folders } });
    mockState.undoable.present.preferences.mediaRouteFolders = { "controller-default": "folder-1" };
    mockState.undoable.present.preferences.mediaRouteFoldersControllerProfileId = "presentation";
    const repair = deferred<any[]>();
    mockRepairPersistedMediaRouteFolders.mockReturnValueOnce(repair.promise);
    const { db } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await userEvent.click(screen.getByRole("radio", { name: "Delete folder but keep contents" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(mockRepairPersistedMediaRouteFolders).toHaveBeenCalledWith(
      db, new Set(["folder-1"]), MEDIA_LIBRARY_ROOT_VIEW,
    ));

    const renamed = { ...original, name: "Concurrent rename" };
    const addedDuringRepair = { ...baseMedia, id: "added-during-repair", name: "Concurrent addition", folderId: "folder-1" };
    const outsideEdit = { ...baseMedia, id: "outside", name: "Edited outside item" };
    mockState = makeBaseState({ media: { list: [renamed, addedDuringRepair, outsideEdit], folders } });
    await act(async () => {
      repair.resolve([]);
      await repair.promise;
    });

    const finalAction = mockDispatch.mock.calls.map(([action]) => action)
      .filter((action) => action.type === "media/setMediaListAndFolders").at(-1);
    expect(finalAction.payload).toEqual({
      list: [
        expect.objectContaining({ id: "kept-media", name: "Concurrent rename", folderId: null }),
        expect.objectContaining({ id: "added-during-repair", name: "Concurrent addition", folderId: null }),
        expect.objectContaining({ id: "outside", name: "Edited outside item" }),
      ],
      folders: [],
    });
    expect(finalAction.payload.list).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "removed-before-finalize" }),
    ]));
    expect(mockFlushMediaLibraryDocToPouch).toHaveBeenCalledWith(
      db,
      finalAction.payload.list,
      [],
      expect.any(Function),
      expect.objectContaining({ list: [original, removedBeforeFinalize], folders }),
      expect.objectContaining({ publishIfCurrent: expect.any(Function) }),
    );
  });

  it("preserves concurrent edits, removals, additions, and child folders during subtree finalization", async () => {
    const baseMedia = makeBaseState().media.list[0];
    const target = { ...baseMedia, id: "subtree-target", name: "Target", folderId: "parent", publicId: "target-asset" };
    const editedOutside = { ...baseMedia, id: "outside-edited", name: "Before", folderId: "outside-folder" };
    const removedOutside = { ...baseMedia, id: "outside-removed", folderId: null };
    const folders = [
      { id: "parent", name: "Parent", parentId: null },
      { id: "child", name: "Child", parentId: "parent" },
      { id: "outside-folder", name: "Outside", parentId: null },
    ];
    mockState = makeBaseState({ media: { list: [target, editedOutside, removedOutside], folders } });
    mockState.undoable.present.preferences.mediaRouteFolders = { "controller-default": "parent" };
    mockState.undoable.present.preferences.mediaRouteFoldersControllerProfileId = "presentation";
    const cleanup = deferred<void>();
    mockDeleteCloudinaryMediaAsset.mockReturnValueOnce(cleanup.promise);
    await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await userEvent.click(screen.getByRole("radio", { name: "Delete folder and contents" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalled());

    const renamedOutside = { ...editedOutside, name: "Changed while cleaning" };
    const addedOutside = { ...baseMedia, id: "added-outside", name: "New outside item", folderId: "outside-folder" };
    const addedInside = { ...baseMedia, id: "added-inside", name: "New item in deleted folder", folderId: "child" };
    const concurrentChild = { id: "concurrent-child", name: "Added child folder", parentId: "child" };
    const latestFolders = [...folders, concurrentChild];
    mockState = makeBaseState({ media: { list: [renamedOutside, addedOutside, addedInside], folders: latestFolders } });

    await act(async () => {
      cleanup.resolve();
      await cleanup.promise;
    });

    const finalAction = mockDispatch.mock.calls.map(([action]) => action)
      .filter((action) => action.type === "media/setMediaListAndFolders").at(-1);
    expect(finalAction.payload.list).toEqual([
      expect.objectContaining({ id: "outside-edited", name: "Changed while cleaning", folderId: "outside-folder" }),
      expect.objectContaining({ id: "added-outside", name: "New outside item", folderId: "outside-folder" }),
      expect.objectContaining({ id: "added-inside", name: "New item in deleted folder", folderId: null }),
    ]);
    expect(finalAction.payload.folders).toEqual([
      expect.objectContaining({ id: "outside-folder", parentId: null }),
      expect.objectContaining({ id: "concurrent-child", parentId: MEDIA_LIBRARY_ROOT_VIEW }),
    ]);
    expect(finalAction.payload.list).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "subtree-target" }),
      expect.objectContaining({ id: "outside-removed" }),
    ]));
  });

  it("continues subtree finalization in A after tombstone and provider cleanup while B is active", async () => {
    const mediaA = {
      ...makeBaseState().media.list[0],
      id: "same-media",
      name: "A image",
      folderId: "same-folder",
      source: "cloudinary" as const,
      publicId: "a-asset",
    };
    const foldersA = [{ id: "same-folder", name: "A folder", parentId: null }];
    mockState = makeBaseState({ media: { list: [mediaA], folders: foldersA } });
    mockState.undoable.present.preferences.mediaRouteFolders = { "controller-default": "same-folder" };
    mockState.undoable.present.preferences.mediaRouteFoldersControllerProfileId = "presentation";
    const cleanup = deferred<void>();
    const flush = deferred<{ ok: true } | { ok: false; error: unknown }>();
    mockDeleteCloudinaryMediaAsset.mockReturnValueOnce(cleanup.promise);
    mockFlushMediaLibraryDocToPouch.mockReturnValueOnce(flush.promise);
    const dbA = { allDocs: jest.fn().mockResolvedValue({ rows: [] }), put: jest.fn() };
    const { view, rerenderScope } = await renderMedia({ dbOverride: dbA });

    await userEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await userEvent.click(screen.getByRole("radio", { name: "Delete folder and contents" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalled());
    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith("church-1", "a-asset"));

    const dbB = { allDocs: jest.fn(), put: jest.fn() };
    mockState = makeBaseState({ media: { list: [{ ...mediaA, name: "B image" }], folders: [{ ...foldersA[0], name: "B folder" }] } });
    mockBroadcastTarget = { postMessage: jest.fn() };
    rerenderScope(dbB, "church-2");
    const dispatchCountAtB = mockDispatch.mock.calls.length;
    const navigationCountAtB = mockNavigate.mock.calls.length;

    await act(async () => {
      cleanup.resolve();
      await cleanup.promise;
    });
    await waitFor(() => expect(mockFlushMediaLibraryDocToPouch).toHaveBeenCalledWith(
      dbA,
      [],
      [],
      expect.any(Function),
      expect.objectContaining({ list: [mediaA], folders: foldersA }),
      expect.objectContaining({ allowOriginalOwnerPersistenceAfterScopeChange: true }),
    ));
    const getAStateForPersistence = mockFlushMediaLibraryDocToPouch.mock.calls.at(-1)?.[3] as () => { list: unknown[]; folders: unknown[] };
    expect(getAStateForPersistence()).toEqual({ list: [], folders: [] });
    expect(mockRepairPersistedMediaRouteFolders).toHaveBeenCalledWith(dbA, new Set(["same-folder"]), MEDIA_LIBRARY_ROOT_VIEW);
    const activityId = mockUpdateTransfer.mock.calls.at(-1)![0].id;
    expect(mockGetTransfer(activityId)?.status).toBe("active");
    expect(mockBroadcastTarget.postMessage).not.toHaveBeenCalled();
    expect(mockDispatch.mock.calls.slice(dispatchCountAtB).map(([action]) => action.type)).not.toContain("preferences/repairActiveMediaRouteFolders");
    expect(mockDispatch.mock.calls.slice(dispatchCountAtB).map(([action]) => action.type)).not.toContain("media/setMediaListAndFolders");
    expect(mockNavigate).toHaveBeenCalledTimes(navigationCountAtB);

    await act(async () => flush.resolve({ ok: true }));
    await waitFor(() => expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "complete",
      phase: expect.objectContaining({ label: "Folder deletion complete" }),
    })));
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledTimes(1);
    expect(dbB.allDocs).not.toHaveBeenCalled();
    expect(dbB.put).not.toHaveBeenCalled();
    expect(view.container).toBeInTheDocument();
  });

  it("keeps detached Activity failed when A folder finalization fails, then retries against A", async () => {
    const mediaA = {
      ...makeBaseState().media.list[0],
      id: "same-media",
      folderId: "same-folder",
      source: "cloudinary" as const,
      publicId: "a-asset",
    };
    const foldersA = [{ id: "same-folder", name: "A folder", parentId: null }];
    mockState = makeBaseState({ media: { list: [mediaA], folders: foldersA } });
    mockState.undoable.present.preferences.mediaRouteFolders = { "controller-default": "same-folder" };
    mockState.undoable.present.preferences.mediaRouteFoldersControllerProfileId = "presentation";
    mockFlushMediaLibraryDocToPouch
      .mockResolvedValueOnce({ ok: false, error: new Error("folder write failed") })
      .mockResolvedValueOnce({ ok: true });
    const dbA = { allDocs: jest.fn().mockResolvedValue({ rows: [] }), put: jest.fn() };
    const { view, rerenderScope } = await renderMedia({ dbOverride: dbA });
    const cleanup = deferred<void>();
    mockDeleteCloudinaryMediaAsset.mockReturnValueOnce(cleanup.promise);

    await userEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await userEvent.click(screen.getByRole("radio", { name: "Delete folder and contents" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalled());
    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalled());
    const dbB = { allDocs: jest.fn(), put: jest.fn() };
    mockState = makeBaseState({ media: { list: [mediaA], folders: foldersA } });
    mockBroadcastTarget = { postMessage: jest.fn() };
    rerenderScope(dbB, "church-2");
    const dispatchCountAtB = mockDispatch.mock.calls.length;
    const navigationCountAtB = mockNavigate.mock.calls.length;
    await act(async () => {
      cleanup.resolve();
      await cleanup.promise;
    });

    const activityId = mockUpdateTransfer.mock.calls.at(-1)![0].id;
    await waitFor(() => expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "partial",
      phase: expect.objectContaining({ label: "Folder finalization needs attention" }),
      error: expect.objectContaining({ message: expect.stringContaining("folder write failed") }),
    })));
    expect(mockGetTransfer(activityId).phase.label).not.toBe("Folder deletion complete");
    view.unmount();
    await waitFor(() => expect(mockGetTransfer(activityId)?.actions).toEqual([
      { key: "retry-cleanup", label: "Retry folder finalization" },
      { key: "dismiss", label: "Dismiss" },
    ]));

    await act(async () => {
      await mockTransferActionHandlers.get(`${activityId}:retry-cleanup`)?.();
    });

    expect(mockFlushMediaLibraryDocToPouch).toHaveBeenCalledTimes(2);
    expect(mockFlushMediaLibraryDocToPouch.mock.calls[0][0]).toBe(dbA);
    expect(mockFlushMediaLibraryDocToPouch.mock.calls[1][0]).toBe(dbA);
    expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "complete",
      phase: expect.objectContaining({ label: "Folder deletion complete" }),
    }));
    expect(mockBroadcastTarget.postMessage).not.toHaveBeenCalled();
    expect(dbB.allDocs).not.toHaveBeenCalled();
    expect(dbB.put).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch.mock.calls.slice(dispatchCountAtB).map(([action]) => action.type)).not.toContain("media/setMediaListAndFolders");
    expect(mockNavigate).toHaveBeenCalledTimes(navigationCountAtB);
  });

  it("registers detached cleanup retry when upload cleanup failure settles after unmount", async () => {
    mockState = makeBaseState();
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...mockState.media.list[0], source: "cloudinary" as const };
    let rejectCancel!: (error: Error) => void;
    const retryUploadCleanup = jest.fn().mockResolvedValue(undefined);
    const uploadClaim = claimMediaUpload("media-1")!;
    uploadClaim.setCancel(() => new Promise<void>((_resolve, reject) => { rejectCancel = reject; }));
    uploadClaim.failCleanup(new Error("upload cleanup failed"), retryUploadCleanup);
    const { view } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));
    await waitFor(() => expect(rejectCancel).toBeDefined());
    const activityId = mockUpdateTransfer.mock.calls.at(-1)![0].id;
    view.unmount();
    await act(async () => {
      rejectCancel(new Error("cancel cleanup unavailable"));
      uploadClaim.release();
    });
    await waitFor(() => expect(mockGetTransfer(activityId)?.actions).toEqual(expect.arrayContaining([
      { key: "retry-cleanup", label: "Retry cleanup" },
      { key: "dismiss", label: "Dismiss" },
    ])));

    await act(async () => { await mockTransferActionHandlers.get(`${activityId}:retry-cleanup`)?.(); });

    expect(retryUploadCleanup).toHaveBeenCalledTimes(1);
    expect(mockDeleteMediaItemAtRevisionFromPouch).not.toHaveBeenCalled();
    expect(mockGetTransfer(activityId)).toEqual(expect.objectContaining({
      status: "failed",
      phase: expect.objectContaining({ label: "Upload cleanup complete; deletion was not resumed" }),
      actions: [{ key: "dismiss", label: "Dismiss" }],
    }));
  });

  it("does not tombstone or clean up a provider when reference cleanup fails", async () => {
    mockState = makeBaseState();
    mockSelectedMediaIds = new Set(["media-1"]);
    mockSelectedMedia = { ...mockState.media.list[0], source: "cloudinary" as const };
    mockSweepMediaReferencesBeforeDelete.mockResolvedValue({
      ok: false,
      failedDocIds: ["quick-links"],
      rollbackStatus: "complete",
    });
    await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));

    await waitFor(() => expect(mockUpdateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Media deletion",
        status: "failed",
        files: expect.arrayContaining([
          expect.objectContaining({ id: "media-1", status: "failed", phase: "References kept" }),
        ]),
        actions: expect.arrayContaining([expect.objectContaining({ key: "retry-delete" })]),
      }),
    ));
    expect(mockDeleteMediaItemAtRevisionFromPouch).not.toHaveBeenCalled();
    expect(mockDeleteCloudinaryMediaAsset).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalledWith({
      type: "media/removeMediaItemFromRemote",
      payload: "media-1",
    });
  });

  it("tracks deleting a folder subtree in Activity", async () => {
    const mediaRow = {
      ...makeBaseState().media.list[0],
      id: "folder-media",
      name: "Folder image",
      folderId: "folder-1",
      source: "uploaded",
    };
    mockState = makeBaseState({
      media: {
        list: [mediaRow],
        folders: [{ id: "folder-1", name: "Sermon slides", parentId: null }],
      },
    });
    mockState.undoable.present.preferences.mediaRouteFolders = {
      "controller-default": "folder-1",
    };
    mockState.undoable.present.preferences.mediaRouteFoldersControllerProfileId = "presentation";
    const { view } = await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await userEvent.click(screen.getByRole("radio", { name: "Delete folder and contents" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));

    await waitFor(() => {
      const activity = mockUpdateTransfer.mock.calls.map(([transfer]) => transfer).at(-1);
      expect(activity).toEqual(expect.objectContaining({
        type: "Media deletion",
        status: "complete",
        name: "Delete folder Sermon slides",
        files: expect.arrayContaining([
          expect.objectContaining({ id: "folder-media", status: "complete", phase: "Removed from Media" }),
        ]),
      }));
    });
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalled();
    const folderTransferId = mockUpdateTransfer.mock.calls.at(-1)![0].id;
    expect(mockGetTransfer(folderTransferId).actions).toEqual([{ key: "dismiss", label: "Dismiss" }]);
    view.unmount();
    expect(mockGetTransfer(folderTransferId).actions).toEqual([{ key: "dismiss", label: "Dismiss" }]);
    expect(mockTransferActionHandlers.has(`${folderTransferId}:dismiss`)).toBe(true);
    await act(async () => { await mockTransferActionHandlers.get(`${folderTransferId}:dismiss`)?.(); });
    expect(mockRemoveTransfer).toHaveBeenCalledWith(folderTransferId);
  });

  it("keeps folder deletion dismissible when Media unmounts while it is pending", async () => {
    const mediaRow = {
      ...makeBaseState().media.list[0],
      id: "pending-folder-media",
      name: "Folder image",
      folderId: "folder-1",
      source: "uploaded",
    };
    mockState = makeBaseState({
      media: {
        list: [mediaRow],
        folders: [{ id: "folder-1", name: "Sermon slides", parentId: null }],
      },
    });
    mockState.undoable.present.preferences.mediaRouteFolders = { "controller-default": "folder-1" };
    mockState.undoable.present.preferences.mediaRouteFoldersControllerProfileId = "presentation";
    let rejectDelete!: (error: Error) => void;
    mockDeleteMediaItemAtRevisionFromPouch.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectDelete = reject; }));
    const user = userEvent.setup();
    const { view } = await renderMedia();

    await user.click(screen.getByRole("button", { name: "Delete folder" }));
    await user.click(screen.getByRole("radio", { name: "Delete folder and contents" }));
    await user.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalled());
    const folderTransferId = mockUpdateTransfer.mock.calls.at(-1)![0].id;

    view.unmount();
    expect(mockGetTransfer(folderTransferId).actions).toEqual([{ key: "dismiss", label: "Dismiss" }]);
    expect(mockTransferActionHandlers.has(`${folderTransferId}:retry-delete`)).toBe(false);
    await act(async () => { await mockTransferActionHandlers.get(`${folderTransferId}:dismiss`)?.(); });
    expect(mockRemoveTransfer).toHaveBeenCalledWith(folderTransferId);
    expect(mockGetTransfer(folderTransferId)).toBeUndefined();
    await act(async () => { rejectDelete(new Error("disk unavailable after unmount")); });
    expect(mockGetTransfer(folderTransferId)).toBeUndefined();
  });

  it("deletes each selected row by its known item id", async () => {
    const original = makeBaseState().media.list[0];
    const rows = ["media-a", "media-b", "media-c"].map((id) => ({
      ...original,
      id,
      name: id,
      source: "uploaded",
    }));
    mockState = makeBaseState({ media: { list: rows, folders: [] } });
    mockSelectedMediaIds = new Set(rows.map((row) => row.id));
    await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete 3 items" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));

    await waitFor(() => expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledTimes(3));
    expect(mockDeleteCloudinaryMediaAsset).not.toHaveBeenCalled();
  });

  it("keeps a later multi-delete row intact when its exact tombstone keeps conflicting", async () => {
    const rows = [
      { ...makeBaseState().media.list[0], id: "row-a", source: "cloudinary", publicId: "asset-a" },
      { ...makeBaseState().media.list[0], id: "row-b", source: "cloudinary", publicId: "asset-b" },
    ];
    mockState = makeBaseState({ media: { list: rows, folders: [] } });
    mockSelectedMediaIds = new Set(rows.map((row) => row.id));
    mockReadMediaItemForDeletion.mockImplementation(async (_db, id: string) => {
      const item = rows.find((row) => row.id === id)!;
      return { item, doc: { ...item, _id: `media-item:${id}`, _rev: `1-${id}`, docType: "mediaItem" } };
    });
    const rollbacks = [jest.fn().mockResolvedValue("complete"),
      jest.fn().mockResolvedValue("complete"), jest.fn().mockResolvedValue("complete")];
    mockSweepMediaReferencesBeforeDelete
      .mockResolvedValueOnce({ ok: true, failedDocIds: [], rollback: jest.fn().mockResolvedValue("complete") })
      .mockResolvedValueOnce({ ok: true, failedDocIds: [], rollback: rollbacks[0] })
      .mockResolvedValueOnce({ ok: true, failedDocIds: [], rollback: rollbacks[1] })
      .mockResolvedValueOnce({ ok: true, failedDocIds: [], rollback: rollbacks[2] });
    mockDeleteMediaItemAtRevisionFromPouch
      .mockResolvedValueOnce("deleted")
      .mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
    await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete 2 items" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));

    await waitFor(() => expect(mockDeleteCloudinaryMediaAsset).toHaveBeenCalledWith(
      "church-1",
      "asset-a",
    ));
    expect(mockDeleteCloudinaryMediaAsset).not.toHaveBeenCalledWith("church-1", "asset-b");
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "media/removeMediaItemFromRemote",
      payload: "row-a",
    });
    expect(mockDispatch).not.toHaveBeenCalledWith({
      type: "media/removeMediaItemFromRemote",
      payload: "row-b",
    });
    expect(rollbacks.every((rollback) => rollback.mock.calls.length === 1)).toBe(true);
    expect(mockSweepMediaReferencesBeforeDelete.mock.calls.map(([, ids]) => [...ids]))
      .toEqual([["row-a"], ["row-b"], ["row-b"], ["row-b"]]);
  });

  it("tombstones Mux video media before attempting Mux cleanup", async () => {
    const video = {
      ...makeBaseState().media.list[0],
      id: "mux-video",
      type: "video",
      source: "mux",
      muxAssetId: "mux-asset-1",
    };
    mockState = makeBaseState({ media: { list: [video], folders: [] } });
    mockSelectedMedia = video as typeof emptySelectedMedia;
    mockSelectedMediaIds = new Set([video.id]);
    await renderMedia();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "confirm-delete" }));

    await waitFor(() => expect(mockDeleteMuxAsset).toHaveBeenCalledWith(
      "church-1",
      "mux-asset-1",
    ));
    expect(mockDeleteMediaItemAtRevisionFromPouch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: "media-item:mux-video", _rev: "1-current" }),
    );
    expect(mockDeleteMediaItemAtRevisionFromPouch.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteMuxAsset.mock.invocationCallOrder[0],
    );
  });
});
