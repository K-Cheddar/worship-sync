import type { ReactNode } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import SlideEditor from "../SlideEditor";
import { ToastContext } from "../../../context/toastContext";
import { PresentationControllerModeProvider } from "../../../context/presentationControllerMode";

const mockDispatch = jest.fn();
let mockState: any;
let mockActiveControllerType = "presentation";

const mockSetIsLyricsEditorOpen = jest.fn((value: boolean) => ({
  type: "item/setIsLyricsEditorOpen",
  payload: value,
}));
const mockUpdateSlides = jest.fn((payload: any) => ({
  type: "item/updateSlides",
  payload,
}));
const mockUpdateBoxes = jest.fn((payload: any) => ({
  type: "item/updateBoxes",
  payload,
}));
const mockUpdateArrangements = jest.fn((payload: any) => ({
  type: "item/updateArrangements",
  payload,
}));
const mockDiscardPendingRemoteItem = jest.fn(() => ({
  type: "item/discardPendingRemoteItem",
}));
const mockApplyPendingRemoteItem = jest.fn(() => ({
  type: "item/applyPendingRemoteItem",
}));
const mockSetShouldShowItemEditor = jest.fn((value: boolean) => ({
  type: "preferences/setShouldShowItemEditor",
  payload: value,
}));
let mockShowToast = jest.fn<any, any[]>(() => "toast-1");
let mockRemoveToast = jest.fn();

const mockFormatFree = jest.fn((item: any) => item);
const mockFormatBible = jest.fn((item: any) => item);
const mockFormatSong = jest.fn((item: any) => item);

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
  useCurrentItem: () => mockState.undoable.present.item,
}));

jest.mock("../../../context/activeController", () => ({
  useActiveControllerProfile: () => ({
    id: "presentation",
    name: "Presentation",
    type: mockActiveControllerType,
    outlineScope: "presentation",
  }),
}));

jest.mock("../../../store/itemSlice", () => ({
  setSelectedBox: jest.fn((value: number) => ({
    type: "item/setSelectedBox",
    payload: value,
  })),
  setSelectedSlide: jest.fn((value: number) => ({
    type: "item/setSelectedSlide",
    payload: value,
  })),
  setIsLyricsEditorOpen: (value: boolean) => mockSetIsLyricsEditorOpen(value),
  setSongMetadata: jest.fn((payload: unknown) => ({
    type: "item/setSongMetadata",
    payload,
  })),
  setSongLinks: jest.fn((payload: unknown) => ({
    type: "item/setSongLinks",
    payload,
  })),
  applyPersistedSongAudio: jest.fn((payload: unknown) => ({
    type: "item/applyPersistedSongAudio",
    payload,
  })),
  updateArrangements: (payload: any) => mockUpdateArrangements(payload),
  updateSlides: (payload: any) => mockUpdateSlides(payload),
  setName: jest.fn((payload: any) => ({ type: "item/setName", payload })),
  updateBoxes: (payload: any) => mockUpdateBoxes(payload),
  discardPendingRemoteItem: () => mockDiscardPendingRemoteItem(),
  applyPendingRemoteItem: () => mockApplyPendingRemoteItem(),
  setRestoreFocusToBox: jest.fn((payload: any) => ({
    type: "item/setRestoreFocusToBox",
    payload,
  })),
}));

// SlideEditor imports runtime `broadcastItemUpdate` from store. Loading the real
// store against the partial itemSlice mock above fails (`itemSlice.actions`).
jest.mock("../../../store/store", () => ({
  broadcastItemUpdate: jest.fn(),
}));

jest.mock("../../../store/allDocsSlice", () => ({
  upsertItemInAllDocs: jest.fn((payload: unknown) => ({
    type: "allDocs/upsertItemInAllDocs",
    payload,
  })),
}));

jest.mock("../../../store/preferencesSlice", () => ({
  setShouldShowItemEditor: (value: boolean) => mockSetShouldShowItemEditor(value),
}));

jest.mock("../../../store/mediaSlice", () => ({
  addItemToMediaList: jest.fn((payload: unknown) => ({
    type: "media/addItemToMediaList",
    payload,
  })),
  updateMediaItemFields: jest.fn((payload: unknown) => ({
    type: "media/updateMediaItemFields",
    payload,
  })),
}));

jest.mock("../../../utils/authStorage", () => ({
  getOrCreateDeviceId: () => "device-1",
}));

jest.mock("../../../utils/deviceInfo", () => ({
  getTrustedDeviceLabel: () => "Booth PC",
}));

jest.mock("../../../utils/localVideoInput", () => {
  const actual = jest.requireActual("../../../utils/localVideoInput");
  return {
    ...actual,
    buildLocalVideoInputPresentation: jest.fn((source: any) => ({
      sourceId: source.sourceId,
      deviceLabel: source.label,
      ownerDeviceId: "device-1",
      ownerLabel: "Booth PC",
      captureKind: source.captureKind,
      fit: source.fit,
      audioEnabled: source.audioEnabled,
    })),
  };
});

jest.mock("../../../components/SongAudioPlayer/SongAudioPlayer", () => ({
  __esModule: true,
  default: () => <div data-testid="song-audio-player" />,
}));

jest.mock("../../../utils/overflow", () => ({
  formatBible: (item: any) => mockFormatBible(item),
  formatFree: (item: any) => mockFormatFree(item),
  formatSong: (item: any) => mockFormatSong(item),
}));

jest.mock("../../../components/ErrorBoundary/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const displayWindowCapture: {
  className: string | undefined;
  showBorder: boolean | undefined;
  onChange: ((info: any) => void) | null;
  videoPlayback: unknown;
  localVideoInput: unknown;
  canCaptureLocalVideo: boolean | undefined;
} = {
  className: undefined,
  showBorder: undefined,
  onChange: null,
  videoPlayback: undefined,
  localVideoInput: undefined,
  canCaptureLocalVideo: undefined,
};

jest.mock("../../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: (props: {
    className?: string;
    disabled?: boolean;
    showBorder?: boolean;
    onChange?: (info: any) => void;
    videoPlayback?: unknown;
    localVideoInput?: unknown;
    canCaptureLocalVideo?: boolean;
  }) => {
    displayWindowCapture.className = props.className;
    displayWindowCapture.showBorder = props.showBorder;
    if (props.onChange) displayWindowCapture.onChange = props.onChange;
    displayWindowCapture.videoPlayback = props.videoPlayback;
    displayWindowCapture.localVideoInput = props.localVideoInput;
    displayWindowCapture.canCaptureLocalVideo = props.canCaptureLocalVideo;
    return (
      <div
        data-testid="display-window"
        data-class-name={props.className}
        data-disabled={props.disabled ? "true" : "false"}
        data-has-video-playback={props.videoPlayback ? "true" : "false"}
        data-has-local-video={props.localVideoInput ? "true" : "false"}
        data-can-capture={props.canCaptureLocalVideo ? "true" : "false"}
      />
    );
  },
}));

jest.mock("../../../components/SectionTextEditor/SectionTextEditor", () => ({
  __esModule: true,
  default: ({
    disabled,
    sectionName,
    value,
    onChange,
  }: {
    disabled?: boolean;
    sectionName: string;
    value: string;
    onChange: (v: string, cursor?: number) => void;
  }) => (
    <div data-testid="section-text-editor" data-disabled={disabled ? "true" : "false"}>
      <span>{sectionName}</span>
      <span>{value}</span>
      <button
        type="button"
        onClick={() => onChange("Updated section text", 3)}
        disabled={disabled}
      >
        trigger-section-change
      </button>
    </div>
  ),
}));

jest.mock("../../../components/SlideBoxes/SlideBoxes", () => ({
  __esModule: true,
  default: () => <div data-testid="slide-boxes" />,
}));

jest.mock("../../../components/LocalVideoInputDetails/LocalVideoInputDetails", () => ({
  __esModule: true,
  default: ({
    source,
    canEdit,
    onEdit,
  }: {
    source: { label: string };
    canEdit: boolean;
    onEdit?: () => void;
  }) => (
    <div data-testid="local-video-input-details">
      <span>{source.label}</span>
      {canEdit ? (
        <button type="button" onClick={onEdit}>
          Edit
        </button>
      ) : null}
    </div>
  ),
}));

jest.mock("../../../components/LocalVideoInputPicker/LocalVideoInputPicker", () => ({
  __esModule: true,
  default: () => <div data-testid="local-video-input-picker" />,
}));

jest.mock("../BibleItemActions", () => ({
  __esModule: true,
  default: () => <div data-testid="bible-actions" />,
}));

jest.mock("../../../components/TimerControls/TimerControls", () => ({
  __esModule: true,
  default: () => <div data-testid="timer-controls" />,
}));

const makeBaseState = (overrides: Partial<any> = {}) => {
  const base = {
    undoable: {
      present: {
        item: {
          _id: "default-item",
          name: "Sample Item",
          type: "free",
          arrangements: [],
          selectedArrangement: 0,
          selectedSlide: 0,
          selectedBox: 1,
          slides: [
            {
              id: "s1",
              type: "Media",
              name: "Section 1A",
              boxes: [
                { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                { width: 100, height: 100, words: "Hello", x: 0, y: 0 },
              ],
            },
          ],
          formattedSections: [{ sectionNum: 1, words: "Hello", slideSpan: 1 }],
          songLinks: [],
          songAudio: undefined,
          isLoading: false,
          isSectionLoading: false,
        },
        preferences: {
          shouldShowItemEditor: true,
          toolbarSection: "settings",
        },
        itemLists: {
          currentLists: [],
          selectedIdByScope: {},
          scope: "presentation",
          selectedList: null,
        },
      },
    },
    presentation: {
      outputs: {},
    },
    media: {
      list: [],
    },
  };
  return {
    ...base,
    ...overrides,
    media: {
      ...base.media,
      ...((overrides as any).media || {}),
    },
    presentation: {
      ...base.presentation,
      ...((overrides as any).presentation || {}),
      outputs: {
        ...base.presentation.outputs,
        ...((overrides as any).presentation?.outputs || {}),
      },
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
        preferences: {
          ...base.undoable.present.preferences,
          ...((overrides as any).undoable?.present?.preferences || {}),
        },
      },
    },
  };
};

const makeStateWithItem = (item: Partial<any>) =>
  makeBaseState({ undoable: { present: { item } } });

const makeOnChangePayload = (overrides: Partial<{
  index: number;
  value: string;
  box: Record<string, unknown>;
  cursorPosition: number;
  lastKeyPressed: string | null;
  commitMode: "typing" | "flush" | "immediate";
}> = {}) => {
  const box = {
    width: 100,
    height: 100,
    words: "text",
    x: 0,
    y: 0,
    excludeFromOverflow: false,
    ...overrides.box,
  };
  return {
    index: 1,
    value: "Hello",
    box,
    cursorPosition: 5,
    lastKeyPressed: null as string | null,
    commitMode: "typing" as const,
    ...overrides,
  };
};

const invokeDisplayOnChange = (payload: ReturnType<typeof makeOnChangePayload>) => {
  if (!displayWindowCapture.onChange) throw new Error("DisplayWindow onChange was not captured");
  act(() => {
    displayWindowCapture.onChange!(payload);
  });
};

const renderWithToastContext = () =>
  render(
    <ToastContext.Provider
      value={{
        showToast: mockShowToast,
        updateToast: jest.fn(),
        removeToast: mockRemoveToast,
      }}
    >
      <SlideEditor access="full" />
    </ToastContext.Provider>
  );

describe("SlideEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveControllerType = "presentation";
    displayWindowCapture.className = undefined;
    displayWindowCapture.showBorder = undefined;
    displayWindowCapture.onChange = null;
    displayWindowCapture.videoPlayback = undefined;
    displayWindowCapture.localVideoInput = undefined;
    displayWindowCapture.canCaptureLocalVideo = undefined;
    mockState = makeBaseState();
    mockShowToast = jest.fn<any, any[]>(() => "toast-1");
    mockRemoveToast = jest.fn();
  });

  it("uses the larger present preview without an outer gray border", () => {
    render(<SlideEditor access="full" presentationMode="present" />);

    expect(displayWindowCapture.className).toContain("lg:max-h-[36vh]");
    expect(displayWindowCapture.className).toContain("max-lg:max-h-[30vh]");
    expect(displayWindowCapture.showBorder).toBeUndefined();
  });

  it("keeps the edit preview free of an outer gray border", () => {
    render(<SlideEditor access="full" />);

    expect(displayWindowCapture.className).toContain("lg:max-h-[42vh]");
    expect(displayWindowCapture.showBorder).toBeUndefined();
  });

  it("uses a preview-only Present skeleton with Present sizing while loading", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: { isLoading: true },
        },
      },
    });

    render(<SlideEditor access="full" presentationMode="present" />);

    expect(screen.getByTestId("slide-editor-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("slide-editor-skeleton-text-column")).not.toBeInTheDocument();
    const preview = screen.getByTestId("slide-editor-skeleton-preview");
    expect(preview.className).toContain("lg:max-h-[36vh]");
    expect(preview.className).toContain("max-lg:max-h-[30vh]");
  });

  it("keeps the Edit skeleton text column and Edit sizing while loading", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: { isLoading: true },
        },
      },
    });

    render(<SlideEditor access="full" presentationMode="edit" />);

    expect(screen.getByTestId("slide-editor-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("slide-editor-skeleton-text-column")).toBeInTheDocument();
    const preview = screen.getByTestId("slide-editor-skeleton-preview");
    expect(preview.className).toContain("lg:max-h-[42vh]");
    expect(preview.className).toContain("max-lg:max-h-[30vh]");
  });

  it("renders empty state when no slide is selected", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [],
          },
        },
      },
    });

    render(<SlideEditor access="full" />);
    expect(screen.getByText("No slide selected")).toBeInTheDocument();
  });

  it("shows a video input banner on the editor preview", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [
              {
                id: "s1",
                type: "Section",
                name: "Section 1",
                mediaSource: {
                  kind: "local-video-input",
                  sourceId: "local_video_1",
                  label: "Booth camera",
                },
                boxes: [
                  { width: 100, height: 100, words: "", x: 0, y: 0 },
                  { width: 100, height: 100, words: "Hello", x: 0, y: 0 },
                ],
              },
            ],
          },
        },
      },
    });

    render(<SlideEditor access="full" />);
    expect(
      screen.getByLabelText("Video input: Booth camera"),
    ).toBeInTheDocument();
  });

  it("lets an auxiliary controller relink a video input in present mode", () => {
    mockActiveControllerType = "aux-presentation";
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [
              {
                id: "s1",
                type: "Section",
                name: "Window share",
                mediaSource: {
                  kind: "local-video-input",
                  sourceId: "local_video_1",
                  label: "Window share",
                  captureKind: "window",
                },
                boxes: [
                  { width: 100, height: 100, words: "", x: 0, y: 0 },
                ],
              },
            ],
          },
        },
      },
    });

    render(<SlideEditor access="full" presentationMode="present" />);

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("lets the main Presentation controller relink a video input in present mode", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [
              {
                id: "s1",
                type: "Section",
                name: "Window share",
                mediaSource: {
                  kind: "local-video-input",
                  sourceId: "local_video_1",
                  label: "Window share",
                  captureKind: "window",
                },
                boxes: [
                  { width: 100, height: 100, words: "", x: 0, y: 0 },
                ],
              },
            ],
          },
        },
      },
    });

    render(<SlideEditor access="full" presentationMode="present" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("local-video-input-picker")).toBeInTheDocument();
  });

  it("shows video input details left of the preview instead of section text", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [
              {
                id: "s1",
                type: "Section",
                name: "Booth camera",
                mediaSource: {
                  kind: "local-video-input",
                  sourceId: "local_video_1",
                  label: "Booth camera",
                  fit: "cover",
                },
                boxes: [
                  { width: 100, height: 100, words: "", x: 0, y: 0 },
                  { width: 100, height: 100, words: "", x: 0, y: 0 },
                ],
              },
            ],
          },
        },
      },
    });

    render(<SlideEditor access="full" />);
    expect(screen.getByTestId("local-video-input-details")).toBeInTheDocument();
    expect(screen.queryByTestId("section-text-editor")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("passes a capturable local video input into the editor preview", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [
              {
                id: "s1",
                type: "Section",
                name: "Booth camera",
                mediaSource: {
                  kind: "local-video-input",
                  sourceId: "local_video_1",
                  label: "Booth camera",
                  fit: "contain",
                },
                boxes: [
                  { width: 100, height: 100, words: "", x: 0, y: 0 },
                  { width: 100, height: 100, words: "", x: 0, y: 0 },
                ],
              },
            ],
          },
        },
      },
    });

    render(<SlideEditor access="full" />);
    expect(screen.getByTestId("display-window")).toHaveAttribute(
      "data-has-local-video",
      "true",
    );
    expect(screen.getByTestId("display-window")).toHaveAttribute(
      "data-can-capture",
      "true",
    );
    expect(displayWindowCapture.localVideoInput).toEqual(
      expect.objectContaining({
        sourceId: "local_video_1",
        deviceLabel: "Booth camera",
      }),
    );
  });

  it("passes the live video playback cue into the editor preview", () => {
    const liveCue = {
      mediaKey: "remote:video-1",
      positionSeconds: 4,
      paused: false,
      atServerMs: 1_000_000,
      generation: 9,
      applySeek: false,
    };
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [
              {
                id: "s1",
                type: "Media",
                name: "Verse 1",
                boxes: [
                  {
                    width: 100,
                    height: 100,
                    words: "",
                    x: 0,
                    y: 0,
                    background: "https://cdn.example/loop.mp4",
                    mediaInfo: {
                      type: "video",
                      id: "video-1",
                      background: "https://cdn.example/loop.mp4",
                      placeholderImage: "https://cdn.example/poster.jpg",
                    },
                  },
                  { width: 100, height: 100, words: "Hello", x: 0, y: 0 },
                ],
              },
            ],
          },
        },
      },
      presentation: {
        outputs: {
          projector: {
            isTransmitting: true,
            info: {
              slide: {
                id: "s1",
                type: "Media",
                name: "Verse 1",
                boxes: [
                  {
                    width: 100,
                    height: 100,
                    words: "",
                    x: 0,
                    y: 0,
                    background: "https://cdn.example/loop.mp4",
                    mediaInfo: {
                      type: "video",
                      id: "video-1",
                      background: "https://cdn.example/loop.mp4",
                    },
                  },
                ],
              },
              videoPlayback: liveCue,
            },
          },
        },
      },
    });

    render(<SlideEditor access="full" />);

    expect(screen.getByTestId("display-window")).toHaveAttribute(
      "data-has-video-playback",
      "true",
    );
    expect(displayWindowCapture.videoPlayback).toEqual(liveCue);
  });

  it("keeps the editor preview video playing before the selected slide is on air", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [
              {
                id: "s1",
                type: "Media",
                name: "Verse 1",
                boxes: [
                  {
                    width: 100,
                    height: 100,
                    words: "",
                    x: 0,
                    y: 0,
                    background: "https://cdn.example/loop.mp4",
                    mediaInfo: {
                      type: "video",
                      id: "video-1",
                      background: "https://cdn.example/loop.mp4",
                    },
                  },
                  { width: 100, height: 100, words: "Hello", x: 0, y: 0 },
                ],
              },
            ],
          },
        },
      },
      presentation: {
        outputs: {
          projector: {
            isTransmitting: true,
            info: {
              slide: {
                id: "other-slide",
                type: "Media",
                name: "Chorus",
                boxes: [
                  {
                    width: 100,
                    height: 100,
                    words: "",
                    x: 0,
                    y: 0,
                    mediaInfo: {
                      type: "video",
                      id: "video-1",
                      background: "https://cdn.example/loop.mp4",
                    },
                  },
                ],
              },
              videoPlayback: {
                mediaKey: "remote:video-1",
                positionSeconds: 4,
                paused: false,
                atServerMs: 1_000_000,
                generation: 9,
                applySeek: false,
              },
            },
          },
        },
      },
    });

    render(<SlideEditor access="full" />);

    expect(screen.getByTestId("display-window")).toHaveAttribute(
      "data-has-video-playback",
      "true",
    );
    expect(displayWindowCapture.videoPlayback).toEqual(
      expect.objectContaining({
        mediaKey: "remote:video-1",
        positionSeconds: 0,
        paused: false,
      }),
    );
  });

  it("renders box tools panel when toolbar section is box-tools", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          preferences: { toolbarSection: "box-tools" },
        },
      },
    });

    render(<SlideEditor access="full" />);
    expect(screen.getByTestId("slide-boxes")).toBeInTheDocument();
    expect(screen.queryByTestId("section-text-editor")).not.toBeInTheDocument();
  });

  it("dispatches edit-mode action when song Edit Lyrics is clicked", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            type: "song",
            arrangements: [{ name: "Default", slides: [], formattedLyrics: [] }],
          },
        },
      },
    });

    render(<SlideEditor access="full" />);
    fireEvent.click(screen.getByRole("button", { name: /edit lyrics/i }));

    await waitFor(() => {
      expect(mockSetIsLyricsEditorOpen).toHaveBeenCalledWith(true);
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/setIsLyricsEditorOpen",
      payload: true,
    });
  });

  it("shows Edit Lyrics and the continuous-mode toggle in Present mode", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            type: "song",
            arrangements: [{ name: "Default", slides: [], formattedLyrics: [] }],
          },
        },
      },
    });
    window.localStorage.setItem("worshipsync_presentation_controller_mode", "present");

    render(
      <PresentationControllerModeProvider>
        <SlideEditor access="full" />
      </PresentationControllerModeProvider>,
    );

    expect(screen.getByRole("button", { name: /edit lyrics/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse item editor" }));
    expect(mockSetShouldShowItemEditor).toHaveBeenCalledWith(false);
  });

  it("opens song details sheet in edit mode when song name edit button is clicked", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            type: "song",
            arrangements: [{ name: "Default", slides: [], formattedLyrics: [] }],
          },
        },
      },
    });

    render(<SlideEditor access="full" />);
    fireEvent.click(screen.getByRole("button", { name: /song details/i }));

    expect(screen.getByLabelText("Song name:")).toBeInTheDocument();
  });

  it("offers toast actions for remote updates outside lyrics edit mode", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            hasRemoteUpdate: true,
            hasPendingUpdate: true,
            isLyricsEditorOpen: false,
          },
        },
      },
    });

    renderWithToastContext();

    expect(mockShowToast).toHaveBeenCalled();

    const firstToastCall = mockShowToast.mock.calls[0]?.[0];
    expect(firstToastCall).toBeDefined();
    const { children: renderToastChildren } = firstToastCall as {
      children: (toastId: string) => ReactNode;
    };
    render(<>{renderToastChildren("toast-1")}</>);

    fireEvent.click(screen.getByRole("button", { name: "Use Their Changes" }));

    expect(mockApplyPendingRemoteItem).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/applyPendingRemoteItem",
    });
    expect(mockRemoveToast).toHaveBeenCalledWith("toast-1");
  });

  it("applies a buffered remote update immediately when the item is not dirty", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            hasRemoteUpdate: true,
            hasPendingUpdate: false,
            isLyricsEditorOpen: false,
          },
        },
      },
    });

    renderWithToastContext();

    expect(mockApplyPendingRemoteItem).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/applyPendingRemoteItem",
    });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("updates free section text and dispatches debounced reformat update", () => {
    jest.useFakeTimers();
    mockFormatFree.mockImplementation((item) => ({
      ...item,
      slides: [{ ...item.slides[0], name: "Section 1A (formatted)" }],
      formattedSections: item.formattedSections,
    }));

    render(<SlideEditor access="full" />);
    fireEvent.click(screen.getByRole("button", { name: "trigger-section-change" }));

    expect(mockUpdateSlides).toHaveBeenCalledWith({
      slides: mockState.undoable.present.item.slides,
      formattedSections: [
        {
          sectionNum: 1,
          words: "Updated section text",
          slideSpan: 1,
        },
      ],
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockFormatFree).toHaveBeenCalled();
    expect(mockUpdateSlides).toHaveBeenLastCalledWith({
      slides: [
        {
          ...mockState.undoable.present.item.slides[0],
          name: "Section 1A (formatted)",
        },
      ],
      formattedSections: [
        {
          sectionNum: 1,
          words: "Updated section text",
          slideSpan: 1,
        },
      ],
    });

    jest.useRealTimers();
  });

  it("updates renamed free headings across section slides, clearing, and reload", () => {
    const slides = ["Section 4", "Section 4A", "Section 4B"].map(
      (name, index) => ({
        id: `section-4-${index}`,
        type: "Media",
        name,
        boxes: [
          { width: 100, height: 100, words: "BG", x: 0, y: 0 },
          { width: 100, height: 100, words: "Section text", x: 0, y: 0 },
        ],
      }),
    );
    let item: any = {
      selectedSlide: 0,
      slides,
      formattedSections: [
        { sectionNum: 4, words: "Section text", slideSpan: 3 },
      ],
    };
    mockState = makeStateWithItem(item);
    const { rerender, unmount } = render(<SlideEditor access="full" />);
    expect(screen.getByTestId("section-text-editor")).toHaveTextContent(
      "Section 4",
    );

    item = {
      ...item,
      formattedSections: [
        {
          sectionNum: 4,
          name: "First",
          words: "Section text",
          slideSpan: 3,
        },
      ],
    };
    mockState = makeStateWithItem(item);
    rerender(<SlideEditor access="full" />);
    expect(screen.getByTestId("section-text-editor")).toHaveTextContent("First");

    for (const selectedSlide of [1, 2]) {
      mockState = makeStateWithItem({ ...item, selectedSlide });
      rerender(<SlideEditor access="full" />);
      expect(screen.getByTestId("section-text-editor")).toHaveTextContent("First");
    }

    const renamedSection = item.formattedSections[0];
    item = {
      ...item,
      formattedSections: [
        { sectionNum: 4, words: renamedSection.words, slideSpan: 3 },
      ],
    };
    mockState = makeStateWithItem(item);
    rerender(<SlideEditor access="full" />);
    expect(screen.getByTestId("section-text-editor")).toHaveTextContent("Section 4");

    fireEvent.click(screen.getByRole("button", { name: "trigger-section-change" }));
    expect(mockUpdateSlides).toHaveBeenCalledWith({
      slides,
      formattedSections: [
        { sectionNum: 4, words: "Updated section text", slideSpan: 3 },
      ],
    });

    // Reopening the editor with the saved item shape keeps the custom name.
    unmount();
    mockState = makeStateWithItem({
      ...item,
      formattedSections: [
        { ...renamedSection, name: "First" },
      ],
    });
    render(<SlideEditor access="full" />);
    expect(screen.getByTestId("section-text-editor")).toHaveTextContent("First");
  });

  it("keeps song and Bible section headings unchanged", () => {
    const songSlides = [
      {
        id: "song-slide",
        type: "Media",
        name: "Verse 1A",
        boxes: [
          { width: 100, height: 100, words: "BG", x: 0, y: 0 },
          { width: 100, height: 100, words: "Lyrics", x: 0, y: 0 },
        ],
      },
    ];
    mockState = makeStateWithItem({
      type: "song",
      slides: songSlides,
      arrangements: [
        {
          name: "Default",
          slides: songSlides,
          formattedLyrics: [{ name: "Verse 1", words: "Lyrics" }],
          songOrder: [{ name: "Verse 1" }],
        },
      ],
      selectedArrangement: 0,
      selectedSlide: 0,
    });
    const { rerender } = render(<SlideEditor access="full" />);
    expect(screen.getByTestId("section-text-editor")).toHaveTextContent("Verse 1");

    mockState = makeStateWithItem({
      type: "bible",
      selectedSlide: 0,
      slides: [
        {
          id: "bible-slide",
          type: "Media",
          name: "Psalm 23",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "Psalm text", x: 0, y: 0 },
          ],
        },
      ],
    });
    rerender(<SlideEditor access="full" />);
    expect(screen.getByTestId("section-text-editor")).toHaveTextContent("Psalm 23");
  });

  it("keeps the latest free slide formatting when a debounced text reformat completes", () => {
    jest.useFakeTimers();
    mockFormatFree.mockImplementation((item: any) => item);

    const initialStyle = {
      backgroundColor: "#111111",
      textColor: "#ffffff",
      fontSize: 1.5,
      paddingX: 2,
      paddingY: 1,
      align: "left",
      isBold: false,
      isItalic: false,
    };
    const updatedStyle = {
      ...initialStyle,
      backgroundColor: "#222222",
    };

    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            type: "free",
            selectedSlide: 0,
            slides: [
              {
                id: "s1",
                type: "Media",
                name: "Section 1A",
                boxes: [
                  { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                  { width: 100, height: 100, words: "Hello", x: 0, y: 0 },
                ],
                formattedTextDisplayInfo: initialStyle,
              },
            ],
            formattedSections: [{ sectionNum: 1, words: "Hello", slideSpan: 1 }],
          },
        },
      },
    });

    const { rerender } = render(<SlideEditor access="full" />);
    fireEvent.click(screen.getByRole("button", { name: "trigger-section-change" }));

    mockUpdateSlides.mockClear();
    mockFormatFree.mockClear();

    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            type: "free",
            selectedSlide: 0,
            slides: [
              {
                id: "s1",
                type: "Media",
                name: "Section 1A",
                boxes: [
                  { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                  { width: 100, height: 100, words: "Hello", x: 0, y: 0 },
                ],
                formattedTextDisplayInfo: updatedStyle,
              },
            ],
            formattedSections: [
              { sectionNum: 1, words: "Updated section text", slideSpan: 1 },
            ],
          },
        },
      },
    });
    rerender(<SlideEditor access="full" />);

    try {
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(mockFormatFree).toHaveBeenCalledTimes(1);
      const formattedArg = mockFormatFree.mock.calls[0][0];
      expect(formattedArg.slides[0].formattedTextDisplayInfo?.backgroundColor).toBe(
        "#222222",
      );
      expect(mockUpdateSlides).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slides: expect.any(Array),
          formattedSections: expect.any(Array),
        }),
      );
      expect(
        mockUpdateSlides.mock.lastCall?.[0].slides[0].formattedTextDisplayInfo
          ?.backgroundColor,
      ).toBe("#222222");
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancels pending debounced free box edit when item identity changes before timeout", () => {
    jest.useFakeTimers();
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            _id: "item-a",
          },
        },
      },
    });

    const { rerender } = render(<SlideEditor access="full" />);
    invokeDisplayOnChange(
      makeOnChangePayload({ value: "Stale typing", commitMode: "typing" })
    );
    expect(mockUpdateSlides).not.toHaveBeenCalled();

    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            _id: "item-b",
            name: "Other item",
            slides: [
              {
                id: "s-other",
                type: "Media",
                name: "Section 1A",
                boxes: [
                  { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                  { width: 100, height: 100, words: "Untouched", x: 0, y: 0 },
                ],
              },
            ],
            formattedSections: [
              { sectionNum: 1, words: "Untouched", slideSpan: 1 },
            ],
          },
        },
      },
    });
    rerender(<SlideEditor access="full" />);

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockUpdateSlides).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("cancels pending debounced free box edit when selected slide changes before timeout", () => {
    jest.useFakeTimers();
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [
              {
                id: "s1",
                type: "Media",
                name: "Section 1A",
                boxes: [
                  { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                  { width: 100, height: 100, words: "A", x: 0, y: 0 },
                ],
              },
              {
                id: "s2",
                type: "Media",
                name: "Section 1B",
                boxes: [
                  { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                  { width: 100, height: 100, words: "B", x: 0, y: 0 },
                ],
              },
            ],
            formattedSections: [
              { sectionNum: 1, words: "A\nB", slideSpan: 2 },
            ],
            selectedSlide: 0,
          },
        },
      },
    });

    const { rerender } = render(<SlideEditor access="full" />);
    invokeDisplayOnChange(
      makeOnChangePayload({ value: "Stale typing", commitMode: "typing" })
    );
    expect(mockUpdateSlides).not.toHaveBeenCalled();

    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: mockState.undoable.present.item.slides,
            formattedSections: mockState.undoable.present.item.formattedSections,
            selectedSlide: 1,
          },
        },
      },
    });
    rerender(<SlideEditor access="full" />);

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockUpdateSlides).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  describe("collapsed item editor", () => {
    it("shows timer control strip when timer item and editor is collapsed", () => {
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "timer",
              slides: [
                {
                  id: "t1",
                  type: "Media",
                  name: "Timer",
                  boxes: [
                    { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                    { width: 100, height: 100, words: "00:00", x: 0, y: 0 },
                  ],
                },
              ],
            },
            preferences: {
              shouldShowItemEditor: false,
              toolbarSection: "settings",
            },
          },
        },
      });

      renderWithToastContext();
      expect(
        screen.getByTestId("timer-item-editor-collapsed-controls"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("display-window")).not.toBeInTheDocument();
    });

    it("keeps hidden editor mounted when collapsed for non-timer items", () => {
      mockState = makeBaseState({
        undoable: {
          present: {
            preferences: {
              shouldShowItemEditor: false,
              toolbarSection: "settings",
            },
          },
        },
      });

      renderWithToastContext();
      expect(
        screen.queryByTestId("timer-item-editor-collapsed-controls"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("display-window")).toBeInTheDocument();
    });

    it("shows Bible actions when Bible item and editor is collapsed", () => {
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "bible",
              bibleInfo: {
                book: "Genesis",
                chapter: "1",
                version: "nkjv",
              },
            },
            preferences: {
              shouldShowItemEditor: false,
              toolbarSection: "settings",
            },
          },
        },
      });

      renderWithToastContext();

      expect(
        screen.getByTestId("bible-item-editor-collapsed-controls"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("bible-actions")).toBeInTheDocument();
      expect(screen.queryByTestId("display-window")).not.toBeInTheDocument();
    });
  });

  describe("onChange (display editor)", () => {
    it("dispatches updateBoxes when type is timer", () => {
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "timer",
              slides: [
                {
                  id: "t1",
                  type: "Media",
                  name: "Timer",
                  boxes: [
                    { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                    { width: 100, height: 100, words: "00:00", x: 0, y: 0 },
                  ],
                },
              ],
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "01:00",
          box: { width: 100, height: 100, words: "01:00", x: 0, y: 0 },
        })
      );

      expect(mockUpdateBoxes).toHaveBeenCalledWith(
        expect.objectContaining({
          boxes: expect.arrayContaining([
            expect.objectContaining({ words: "01:00" }),
          ]),
        })
      );
    });

    it("dispatches formatBible and updateSlides when type is bible and value changes", () => {
      const slides = [
        {
          id: "b1",
          type: "Media",
          name: "Verse 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "First", x: 0, y: 0 },
          ],
        },
      ];
      mockFormatBible.mockReturnValue({
        ...mockState.undoable.present.item,
        slides: [{ ...slides[0], boxes: expect.any(Array) }],
      });

      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "bible",
              slides,
              bibleInfo: { fontMode: "separate" },
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "Updated verse",
          box: { width: 100, height: 100, words: "Updated verse", x: 0, y: 0 },
        })
      );

      expect(mockFormatBible).toHaveBeenCalled();
      expect(mockUpdateSlides).toHaveBeenCalledWith(
        expect.objectContaining({
          slides: expect.any(Array),
        })
      );
    });

    it("dispatches updateSlides with one fewer slide when bible and Backspace with empty value", () => {
      const slides = [
        {
          id: "b1",
          type: "Media",
          name: "Verse 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "", x: 0, y: 0 },
          ],
        },
        {
          id: "b2",
          type: "Media",
          name: "Verse 2",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "Second", x: 0, y: 0 },
          ],
        },
      ];
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "bible",
              selectedSlide: 0,
              slides,
              bibleInfo: { fontMode: "separate" },
            },
          },
        },
      });
      mockFormatBible.mockImplementation((opts: any) => ({
        ...opts.item,
        slides: opts.item.slides,
      }));

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "",
          lastKeyPressed: "Backspace",
          box: { width: 100, height: 100, words: "", x: 0, y: 0 },
        })
      );

      expect(mockFormatBible).toHaveBeenCalledWith(
        expect.objectContaining({
          item: expect.objectContaining({
            slides: expect.arrayContaining([
              expect.objectContaining({ name: "Verse 2" }),
            ]),
          }),
        })
      );
      const updateSlidesPayload = mockUpdateSlides.mock.calls[0]?.[0];
      expect(updateSlidesPayload.slides).toHaveLength(1);
    });

    it("keeps free slides when Backspace clears all text instead of deleting the slide", () => {
      // Contract change: clearing text on a custom (free) item used to remove the
      // slide on empty Backspace; empty slides are kept so operators can keep
      // editing structure without losing the slide.
      jest.useFakeTimers();
      mockFormatFree.mockImplementation((item: any) => ({
        ...item,
        slides: item.slides,
        formattedSections: item.formattedSections,
      }));

      const slides = [
        {
          id: "s1",
          type: "Media",
          name: "Section 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "Hi", x: 0, y: 0 },
          ],
        },
      ];
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "free",
              selectedSlide: 0,
              slides,
              formattedSections: [
                { sectionNum: 1, words: "Hi", slideSpan: 1 },
              ],
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "",
          lastKeyPressed: "Backspace",
          box: { width: 100, height: 100, words: "", x: 0, y: 0 },
        })
      );

      expect(mockFormatFree).not.toHaveBeenCalled();
      expect(mockUpdateSlides).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockFormatFree).toHaveBeenCalled();
      expect(mockUpdateSlides).toHaveBeenCalledWith(
        expect.objectContaining({
          slides: expect.any(Array),
          formattedSections: expect.any(Array),
        })
      );
      expect(mockUpdateSlides.mock.calls[0][0].slides).toHaveLength(1);

      jest.useRealTimers();
    });

    it("dispatches formatFree and updateSlides when type is free and value changes", () => {
      jest.useFakeTimers();
      mockFormatFree.mockImplementation((item: any) => ({
        ...item,
        slides: item.slides,
        formattedSections: item.formattedSections,
      }));

      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "free",
              selectedSlide: 0,
              slides: [
                {
                  id: "s1",
                  type: "Media",
                  name: "Section 1A",
                  boxes: [
                    { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                    { width: 100, height: 100, words: "Hello", x: 0, y: 0 },
                  ],
                },
              ],
              formattedSections: [{ sectionNum: 1, words: "Hello", slideSpan: 1 }],
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "New text",
          box: { width: 100, height: 100, words: "New text", x: 0, y: 0 },
        })
      );

      expect(mockFormatFree).not.toHaveBeenCalled();
      expect(mockUpdateSlides).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockFormatFree).toHaveBeenCalled();
      expect(mockUpdateSlides).toHaveBeenCalledWith(
        expect.objectContaining({
          slides: expect.any(Array),
          formattedSections: expect.any(Array),
        })
      );

      jest.useRealTimers();
    });

    it("dispatches updateBoxes for song when on title slide (selectedSlide 0)", () => {
      const slides = [
        {
          id: "title",
          type: "Media",
          name: "Title",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "Song Title", x: 0, y: 0 },
          ],
        },
        {
          id: "v1",
          type: "Media",
          name: "Verse 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            {
              width: 100,
              height: 100,
              words: "Verse",
              x: 0,
              y: 0,
              slideIndex: 0,
            },
          ],
        },
      ];
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "song",
              selectedSlide: 0,
              selectedArrangement: 0,
              arrangements: [
                {
                  name: "Default",
                  slides,
                  formattedLyrics: [
                    { name: "Verse 1", words: "Verse", slideSpan: 1 },
                  ],
                  songOrder: [{ name: "Verse 1" }],
                },
              ],
              slides,
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "New Title",
          box: { width: 100, height: 100, words: "New Title", x: 0, y: 0 },
        })
      );

      expect(mockUpdateBoxes).toHaveBeenCalled();
      expect(mockUpdateArrangements).not.toHaveBeenCalled();
    });

    it("dispatches updateArrangements for song when on overflow slide and value changes", () => {
      jest.useFakeTimers();
      const slides = [
        {
          id: "title",
          type: "Media",
          name: "Title",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "Title", x: 0, y: 0 },
          ],
        },
        {
          id: "v1",
          type: "Media",
          name: "Verse 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            {
              width: 100,
              height: 100,
              words: "Line one",
              x: 0,
              y: 0,
              slideIndex: 0,
            },
          ],
        },
        {
          id: "blank",
          type: "Media",
          name: "Blank",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "", x: 0, y: 0 },
          ],
        },
      ];
      mockFormatSong.mockImplementation((item: any) => item);

      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "song",
              selectedSlide: 1,
              selectedArrangement: 0,
              arrangements: [
                {
                  name: "Default",
                  slides,
                  formattedLyrics: [
                    { name: "Verse 1", words: "Line one", slideSpan: 1 },
                  ],
                  songOrder: [{ name: "Verse 1" }],
                },
              ],
              slides,
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "Line one updated",
          box: {
            width: 100,
            height: 100,
            words: "Line one updated",
            x: 0,
            y: 0,
            slideIndex: 0,
          },
        })
      );

      expect(mockFormatSong).not.toHaveBeenCalled();
      expect(mockUpdateArrangements).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockFormatSong).toHaveBeenCalled();
      expect(mockUpdateArrangements).toHaveBeenCalledWith(
        expect.objectContaining({
          arrangements: expect.any(Array),
        })
      );

      jest.useRealTimers();
    });

    it("reformats song overflow edits immediately when Enter is pressed", () => {
      jest.useFakeTimers();
      const slides = [
        {
          id: "title",
          type: "Media",
          name: "Title",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "Title", x: 0, y: 0 },
          ],
        },
        {
          id: "v1",
          type: "Media",
          name: "Verse 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            {
              width: 100,
              height: 100,
              words: "Line one",
              x: 0,
              y: 0,
              slideIndex: 0,
            },
          ],
        },
        {
          id: "blank",
          type: "Media",
          name: "Blank",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "", x: 0, y: 0 },
          ],
        },
      ];
      mockFormatSong.mockImplementation((item: any) => item);

      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "song",
              selectedSlide: 1,
              selectedArrangement: 0,
              arrangements: [
                {
                  name: "Default",
                  slides,
                  formattedLyrics: [
                    { name: "Verse 1", words: "Line one", slideSpan: 1 },
                  ],
                  songOrder: [{ name: "Verse 1" }],
                },
              ],
              slides,
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "Line one\nLine two",
          lastKeyPressed: "Enter",
          box: {
            width: 100,
            height: 100,
            words: "Line one\nLine two",
            x: 0,
            y: 0,
            slideIndex: 0,
          },
        })
      );

      expect(mockFormatSong).toHaveBeenCalled();
      expect(mockUpdateArrangements).toHaveBeenCalledWith(
        expect.objectContaining({
          arrangements: expect.any(Array),
        })
      );

      jest.useRealTimers();
    });

    it("dispatches updateArrangements with fewer slides when song and Backspace with empty value", () => {
      const slides = [
        {
          id: "title",
          type: "Media",
          name: "Title",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "Title", x: 0, y: 0 },
          ],
        },
        {
          id: "v1",
          type: "Media",
          name: "Verse 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            {
              width: 100,
              height: 100,
              words: "",
              x: 0,
              y: 0,
              slideIndex: 0,
            },
          ],
        },
        {
          id: "blank",
          type: "Media",
          name: "Blank",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "", x: 0, y: 0 },
          ],
        },
      ];
      mockFormatSong.mockImplementation((item: any) => ({
        ...item,
        arrangements: item.arrangements.map((arr: any, i: number) =>
          i === 0 ? { ...arr, slides: arr.slides.slice(0, -1) } : arr
        ),
      }));

      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "song",
              selectedSlide: 1,
              selectedArrangement: 0,
              arrangements: [
                {
                  name: "Default",
                  slides,
                  formattedLyrics: [
                    { name: "Verse 1", words: "", slideSpan: 1 },
                  ],
                  songOrder: [{ name: "Verse 1" }],
                },
              ],
              slides,
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "",
          lastKeyPressed: "Backspace",
          box: { width: 100, height: 100, words: "", x: 0, y: 0, slideIndex: 0 },
        })
      );

      expect(mockFormatSong).toHaveBeenCalled();
      expect(mockUpdateArrangements).toHaveBeenCalledWith(
        expect.objectContaining({
          arrangements: expect.any(Array),
        })
      );
    });

    it("does not dispatch for song when on last slide", () => {
      const slides = [
        {
          id: "title",
          type: "Media",
          name: "Title",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "T", x: 0, y: 0 },
          ],
        },
        {
          id: "blank",
          type: "Media",
          name: "Blank",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "", x: 0, y: 0 },
          ],
        },
      ];
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "song",
              selectedSlide: 1,
              selectedArrangement: 0,
              arrangements: [
                {
                  name: "Default",
                  slides,
                  formattedLyrics: [],
                  songOrder: [],
                },
              ],
              slides,
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "x",
          box: { width: 100, height: 100, words: "x", x: 0, y: 0 },
        })
      );

      expect(mockUpdateBoxes).not.toHaveBeenCalled();
      expect(mockUpdateArrangements).not.toHaveBeenCalled();
    });

    it("does not dispatch for song when arrangement has no slides", () => {
      const slides = [
        {
          id: "title",
          type: "Media",
          name: "Title",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "T", x: 0, y: 0 },
          ],
        },
        {
          id: "v1",
          type: "Media",
          name: "Verse 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "V", x: 0, y: 0 },
          ],
        },
      ];
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "song",
              selectedSlide: 0,
              selectedArrangement: 0,
              arrangements: [
                {
                  name: "Default",
                  slides: undefined as any,
                  formattedLyrics: [],
                  songOrder: [],
                },
              ],
              slides,
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "x",
          box: { width: 100, height: 100, words: "x", x: 0, y: 0 },
        })
      );

      expect(mockUpdateBoxes).not.toHaveBeenCalled();
      expect(mockUpdateArrangements).not.toHaveBeenCalled();
    });

    it("dispatches updateBoxes for song when box has excludeFromOverflow", () => {
      const slides = [
        {
          id: "title",
          type: "Media",
          name: "Title",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "T", x: 0, y: 0 },
          ],
        },
        {
          id: "v1",
          type: "Media",
          name: "Verse 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            {
              width: 100,
              height: 100,
              words: "Verse",
              x: 0,
              y: 0,
              slideIndex: 0,
              excludeFromOverflow: true,
            },
          ],
        },
        {
          id: "blank",
          type: "Media",
          name: "Blank",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "", x: 0, y: 0 },
          ],
        },
      ];
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "song",
              selectedSlide: 1,
              selectedArrangement: 0,
              arrangements: [
                {
                  name: "Default",
                  slides,
                  formattedLyrics: [{ name: "Verse 1", words: "Verse", slideSpan: 1 }],
                  songOrder: [{ name: "Verse 1" }],
                },
              ],
              slides,
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "Updated",
          box: {
            width: 100,
            height: 100,
            words: "Updated",
            x: 0,
            y: 0,
            excludeFromOverflow: true,
          },
        })
      );

      expect(mockUpdateBoxes).toHaveBeenCalled();
      expect(mockUpdateArrangements).not.toHaveBeenCalled();
    });

    it("dispatches updateBoxes for song when no formatted lyric matches current slide", () => {
      const slides = [
        {
          id: "title",
          type: "Media",
          name: "Title",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "T", x: 0, y: 0 },
          ],
        },
        {
          id: "v1",
          type: "Media",
          name: "Verse 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            {
              width: 100,
              height: 100,
              words: "Text",
              x: 0,
              y: 0,
              slideIndex: 0,
            },
          ],
        },
        {
          id: "blank",
          type: "Media",
          name: "Blank",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "", x: 0, y: 0 },
          ],
        },
      ];
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "song",
              selectedSlide: 1,
              selectedArrangement: 0,
              arrangements: [
                {
                  name: "Default",
                  slides,
                  formattedLyrics: [
                    { name: "Chorus", words: "Chorus", slideSpan: 1 },
                  ],
                  songOrder: [{ name: "Chorus" }],
                },
              ],
              slides,
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "New",
          box: {
            width: 100,
            height: 100,
            words: "New",
            x: 0,
            y: 0,
            slideIndex: 0,
          },
        })
      );

      expect(mockUpdateBoxes).toHaveBeenCalled();
      expect(mockUpdateArrangements).not.toHaveBeenCalled();
    });

    it("dispatches formatFree and updateSlides when free section slide not found in section (fallback)", () => {
      jest.useFakeTimers();
      mockFormatFree.mockImplementation((item: any) => ({
        ...item,
        slides: item.slides,
        formattedSections: item.formattedSections || [],
      }));

      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "free",
              selectedSlide: 0,
              slides: [
                {
                  id: "s1",
                  type: "Media",
                  name: "Section 2A",
                  boxes: [
                    { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                    { width: 100, height: 100, words: "Only", x: 0, y: 0 },
                  ],
                },
              ],
              formattedSections: [{ sectionNum: 2, words: "Only", slideSpan: 1 }],
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "Updated",
          box: { width: 100, height: 100, words: "Updated", x: 0, y: 0 },
        })
      );

      expect(mockFormatFree).not.toHaveBeenCalled();
      expect(mockUpdateSlides).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockFormatFree).toHaveBeenCalledWith(
        expect.objectContaining({
          slides: expect.any(Array),
        })
      );
      expect(mockUpdateSlides).toHaveBeenCalledWith(
        expect.objectContaining({
          slides: expect.any(Array),
        })
      );

      jest.useRealTimers();
    });

    it("dispatches formatFree with combined section words when free has multiple slides in section", () => {
      jest.useFakeTimers();
      mockFormatFree.mockImplementation((item: any) => ({
        ...item,
        slides: item.slides,
        formattedSections: item.formattedSections,
      }));

      const slides = [
        {
          id: "s1",
          type: "Media",
          name: "Section 1A",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "First", x: 0, y: 0 },
          ],
        },
        {
          id: "s2",
          type: "Media",
          name: "Section 1B",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "Second", x: 0, y: 0 },
          ],
        },
      ];
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "free",
              selectedSlide: 0,
              slides,
              formattedSections: [
                { sectionNum: 1, words: "First\nSecond", slideSpan: 2 },
              ],
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "First updated",
          box: { width: 100, height: 100, words: "First updated", x: 0, y: 0 },
        })
      );

      expect(mockFormatFree).not.toHaveBeenCalled();
      expect(mockUpdateSlides).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockFormatFree).toHaveBeenCalled();
      const formatFreeArg = mockFormatFree.mock.calls[0][0];
      expect(formatFreeArg.formattedSections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sectionNum: 1,
            words: "First updated\nSecond",
          }),
        ])
      );
      expect(mockUpdateSlides).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it("keeps free slides when Delete clears all text instead of deleting the slide", () => {
      // Same contract as Backspace: empty Delete on free items must not remove the slide.
      jest.useFakeTimers();
      mockFormatFree.mockImplementation((item: any) => ({
        ...item,
        slides: item.slides,
        formattedSections: item.formattedSections,
      }));

      const slides = [
        {
          id: "s1",
          type: "Media",
          name: "Section 1",
          boxes: [
            { width: 100, height: 100, words: "BG", x: 0, y: 0 },
            { width: 100, height: 100, words: "Hi", x: 0, y: 0 },
          ],
        },
      ];
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "free",
              selectedSlide: 0,
              slides,
              formattedSections: [
                { sectionNum: 1, words: "Hi", slideSpan: 1 },
              ],
            },
          },
        },
      });

      render(<SlideEditor access="full" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "",
          lastKeyPressed: "Delete",
          box: { width: 100, height: 100, words: "", x: 0, y: 0 },
        })
      );

      expect(mockFormatFree).not.toHaveBeenCalled();
      expect(mockUpdateSlides).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockFormatFree).toHaveBeenCalled();
      expect(mockUpdateSlides).toHaveBeenCalledWith(
        expect.objectContaining({
          slides: expect.any(Array),
          formattedSections: expect.any(Array),
        })
      );
      expect(mockUpdateSlides.mock.calls[0][0].slides).toHaveLength(1);

      jest.useRealTimers();
    });

    it("does not dispatch when canEdit is false (access read)", () => {
      mockState = makeBaseState({
        undoable: {
          present: {
            item: {
              type: "free",
              slides: [
                {
                  id: "s1",
                  type: "Media",
                  name: "Section 1A",
                  boxes: [
                    { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                    { width: 100, height: 100, words: "Hello", x: 0, y: 0 },
                  ],
                },
              ],
            },
          },
        },
      });

      render(<SlideEditor access="view" />);
      invokeDisplayOnChange(
        makeOnChangePayload({
          index: 1,
          value: "Hacked",
          box: { width: 100, height: 100, words: "Hacked", x: 0, y: 0 },
        })
      );

      expect(mockUpdateSlides).not.toHaveBeenCalled();
      expect(mockUpdateBoxes).not.toHaveBeenCalled();
      expect(mockUpdateArrangements).not.toHaveBeenCalled();
      expect(mockFormatFree).not.toHaveBeenCalled();
    });
  });
});
