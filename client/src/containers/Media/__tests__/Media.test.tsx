import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  updateMediaList: jest.fn((payload: any) => ({ type: "media/updateMediaList", payload })),
  updateMediaListFromRemote: jest.fn((payload: any) => ({
    type: "media/updateMediaListFromRemote",
    payload,
  })),
  addItemToMediaList: jest.fn((payload: any) => ({ type: "media/addItemToMediaList", payload })),
}));

jest.mock("../../../store/preferencesSlice", () => ({
  setDefaultPreferences: (payload: any) => mockSetDefaultPreferences(payload),
  setIsMediaExpanded: jest.fn((payload: boolean) => ({
    type: "preferences/setIsMediaExpanded",
    payload,
  })),
  setMediaItems: (payload: number) => mockSetMediaItems(payload),
  setSelectedQuickLinkImage: (payload: any) => mockSetSelectedQuickLinkImage(payload),
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
  sweepMediaReferencesBeforeDelete: jest.fn().mockResolvedValue({ ok: true, failedDocIds: [] }),
}));

jest.mock("../../../utils/flushMediaLibraryDoc", () => ({
  flushMediaLibraryDocToPouch: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock("../MediaUploadInput", () => {
  const ReactLib = require("react") as typeof React;
  return {
    __esModule: true,
    default: ReactLib.forwardRef(
      (
        { onUploadActiveChange }: { onUploadActiveChange?: (active: boolean) => void },
        ref: React.Ref<{ openModal: () => void; getUploadStatus: () => { isUploading: boolean; progress: number } }>
      ) => {
        ReactLib.useImperativeHandle(ref, () => ({
          openModal: mockOpenModal,
          getUploadStatus: () => ({ isUploading: false, progress: 0 }),
        }));
        return (
          <button
            type="button"
            onClick={() => onUploadActiveChange?.(true)}
          >
            trigger-upload-active
          </button>
        );
      }
    ),
  };
});

const makeBaseState = (overrides: Partial<any> = {}) => {
  const base = {
    presentation: {
      isProjectorTransmitting: false,
    },
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
}: {
  isMobile?: boolean;
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
        } as any
      }
    >
      <Media />
    </ControllerInfoContext.Provider>
  );

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
    expect(screen.getByAltText("media-1")).toBeInTheDocument();
  });

  it("uses mobile media grid defaults when running on mobile", async () => {
    await renderMedia({ isMobile: true });

    expect(mockSetMediaItems).toHaveBeenCalledWith(3);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "preferences/setMediaItems",
      payload: 3,
    });
  });

  it("filters media by search and shows empty state message", async () => {
    await renderMedia();

    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: "does-not-exist" },
    });

    expect(screen.getByText('No media found matching "does-not-exist"')).toBeInTheDocument();
  });

  it("opens upload modal from add-media button", async () => {
    await renderMedia();

    fireEvent.click(screen.getByTitle("Add Media"));
    expect(mockOpenModal).toHaveBeenCalledTimes(1);
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
      await user.click(await screen.findByRole("menuitem", { name: /Rename/i }));
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
      expect.objectContaining({ type: "preferences/setSelectedQuickLinkImage" }),
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
      presentation: { isProjectorTransmitting: true },
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
          slide: expect.objectContaining({
            type: "Section",
            name: "Section 1",
          }),
        }),
      }),
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      'Sent "Sunrise Image" to projector.',
      "success",
    );
  });
});
