import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
  useMediaSelection: () => ({
    selectedMedia: {
      id: "",
      background: "",
      type: "image",
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
      source: "cloudinary",
    },
    selectedMediaIds: new Set<string>(),
    previewMedia: null,
    setPreviewMedia: jest.fn(),
    handleMediaClick: mockSelectionHandleClick,
    clearSelection: mockClearSelection,
  }),
}));

jest.mock("../../../hooks/useGlobalBroadcast", () => ({
  useGlobalBroadcast: (cb: (...args: unknown[]) => unknown) =>
    mockUseGlobalBroadcast(cb),
}));

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useLocation: () => mockUseLocation(),
}));

jest.mock("../../../store/mediaSlice", () => ({
  initiateMediaList: (payload: any) => mockInitiateMediaList(payload),
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
}));

jest.mock("../../../store/itemSlice", () => ({
  updateAllSlideBackgrounds: jest.fn((payload: any) => ({
    type: "item/updateAllSlideBackgrounds",
    payload,
  })),
  updateSlideBackground: (payload: any) => mockUpdateSlideBackground(payload),
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

jest.mock("../../../components/ContextMenu/ContextMenu", () => ({
  __esModule: true,
  default: ({
    children,
    menuItems = [],
  }: {
    children: React.ReactNode;
    menuItems?: Array<{ label: string; onClick: () => void }>;
  }) => (
    <div>
      {children}
      {menuItems.map((item) => (
        <button
          key={item.label}
          type="button"
          data-testid={`context-item-${item.label}`}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
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
    media: {
      list: [
        {
          id: "media-1",
          name: "Sunrise Image",
          type: "image",
          thumbnail: "https://example.com/thumb.jpg",
          background: "https://example.com/bg.jpg",
          source: "cloudinary",
        },
      ],
    },
    undoable: {
      present: {
        item: {
          isLoading: false,
        },
        overlay: {
          selectedOverlay: null,
        },
        preferences: {
          isMediaExpanded: true,
          mediaItemsPerRow: 5,
          selectedPreference: null,
          selectedQuickLink: null,
        },
      },
    },
  };

  return {
    ...base,
    ...overrides,
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

const renderMedia = async ({
  isMobile = false,
  dbGetResult = { list: [] },
}: {
  isMobile?: boolean;
  dbGetResult?: any;
} = {}) => {
  const db = {
    get: jest.fn().mockResolvedValue(dbGetResult),
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

  await waitFor(() => {
    expect(db.get).toHaveBeenCalledWith("media");
  });

  return { db };
};

describe("Media", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocation.mockReturnValue({ pathname: "/item/123" });
    mockState = makeBaseState();
  });

  it("loads media from db and dispatches initialization actions", async () => {
    const remoteList = [{ id: "remote-1", name: "Remote", type: "image" }];
    await renderMedia({ isMobile: false, dbGetResult: { list: remoteList } });

    await waitFor(() => {
      expect(mockSetMediaItems).toHaveBeenCalledWith(5);
    });
    expect(mockInitiateMediaList).toHaveBeenCalledWith(remoteList);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "preferences/setMediaItems",
      payload: 5,
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "media/initiateMediaList",
      payload: remoteList,
    });
    expect(screen.getByAltText("media-1")).toBeInTheDocument();
  });

  it("uses mobile media grid defaults when running on mobile", async () => {
    await renderMedia({ isMobile: true, dbGetResult: { list: [] } });

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

  it("dispatches quick-link media background action from context menu", async () => {
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
    await renderMedia();

    fireEvent.click(screen.getByTestId("context-item-Set Quick Link Background"));

    expect(mockSetSelectedQuickLinkImage).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "preferences/setSelectedQuickLinkImage" }),
    );
  });

  it("dispatches overlay image actions from overlays route context menu", async () => {
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
    await renderMedia();

    fireEvent.click(screen.getByTestId("context-item-Set Image Overlay"));

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
  });
});
