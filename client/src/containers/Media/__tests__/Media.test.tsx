import React from "react";
import { getCanvaStatus } from "../../../api/canva";
import { fromLegacyPresentationShape } from "../../../store/presentationSlice";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Media from "../Media";
import { ControllerInfoContext } from "../../../context/controllerInfo";

const mockDispatch = jest.fn();
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
const mockUpdateSlideBackground = jest.fn((payload: any) => ({
  type: "item/updateSlideBackground",
  payload,
}));

let mockState: any;

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

jest.mock("../../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
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
  default: () => null,
}));

jest.mock("../MediaModal", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../../../utils/mediaReferenceSweep", () => ({
  sweepMediaReferencesBeforeDelete: jest
    .fn()
    .mockResolvedValue({ ok: true, failedDocIds: [] }),
}));

jest.mock("../../../utils/flushMediaLibraryDoc", () => ({
  flushMediaLibraryDocToPouch: jest.fn().mockResolvedValue({ ok: true }),
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
        {
          onUploadActiveChange,
        }: { onUploadActiveChange?: (active: boolean) => void },
        ref: React.Ref<{
          openModal: () => void;
          getUploadStatus: () => { isUploading: boolean; progress: number };
        }>,
      ) => {
        ReactLib.useImperativeHandle(ref, () => ({
          openModal: mockOpenModal,
          getUploadStatus: () => ({ isUploading: false, progress: 0 }),
        }));
        return (
          <button type="button" onClick={() => onUploadActiveChange?.(true)}>
            trigger-upload-active
          </button>
        );
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
}: {
  isMobile?: boolean;
  isGuestSession?: boolean;
} = {}) => {
  const db = {
    get: jest.fn().mockResolvedValue({ list: [], folders: [] }),
  };
  const cloud = { image: jest.fn(), video: jest.fn() };
  const updater = new EventTarget();

  render(
    <ControllerInfoContext.Provider
      value={
        {
          db,
          cloud,
          updater,
          isMobile,
          isGuestSession,
        } as any
      }
    >
      <Media />
    </ControllerInfoContext.Provider>,
  );

  await waitFor(() => {
    expect(mockGetCanvaStatus).toHaveBeenCalled();
  });
  const statusResult = mockGetCanvaStatus.mock.results.at(-1)?.value;
  if (statusResult) {
    await act(async () => {
      await statusResult;
    });
  }

  return { db };
};

describe("Media", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it("renders media from store and sets media items per row", async () => {
    await renderMedia({ isMobile: false });

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
    expect(screen.getByRole("option", { name: "Uploaded" })).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /Other devices/i }),
    ).not.toBeInTheDocument();
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
});
