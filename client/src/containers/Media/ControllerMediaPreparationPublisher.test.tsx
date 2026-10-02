import { render, waitFor } from "@testing-library/react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import ControllerMediaPreparationPublisher from "./ControllerMediaPreparationPublisher";
import type { ControllerProfile } from "../../utils/controllerProfiles";

const publishManifest = jest.fn();
const discoverMedia = jest.fn();
const mockPublishPreparedContext = jest.fn();
const mockSubscribePreparedContextRequests = jest.fn(() => jest.fn());

jest.mock("../../utils/preparedMediaContext", () => ({
  publishPreparedMediaContext: (...args: unknown[]) => mockPublishPreparedContext(...args),
  subscribePreparedMediaContextRequests: (...args: unknown[]) =>
    mockSubscribePreparedContextRequests(...args),
}));

const profile: ControllerProfile = {
  id: "presentation",
  type: "presentation",
  name: "Main",
  description: "",
  order: 0,
  enabled: true,
  outputIds: [],
  outputsConfigured: false,
  defaultSendOutputIds: [],
  outlineScope: "presentation",
};

const auxProfile: ControllerProfile = {
  ...profile,
  id: "aux",
  type: "aux-presentation",
  name: "Lobby",
  outputIds: ["tvs"],
  outputsConfigured: true,
  outlineScope: "aux",
};

let activeProfile = profile;
const outputs = [
  { id: "projector", type: "projector" as const, name: "Projector", order: 0, enabled: true },
  { id: "tvs", type: "projector" as const, name: "TVs", order: 1, enabled: true },
  { id: "monitor", type: "monitor" as const, name: "Monitor", order: 2, enabled: true },
  { id: "stream", type: "stream" as const, name: "Stream", order: 3, enabled: true },
];
const outlineLists = [
  { _id: "outline-1", name: "Sunday", items: [], controllerScope: "presentation" },
  { _id: "outline-aux", name: "Lobby service", items: [], controllerScope: "aux" },
];
let state = {
  displayOutputs: { list: outputs },
  controllerProfiles: { list: [profile, auxProfile] },
  presentation: {
    outputs: {
      projector: { id: "projector", type: "projector" as const },
      monitor: { id: "monitor", type: "monitor" as const },
      stream: { id: "stream", type: "stream" as const },
      tvs: { id: "tvs", type: "projector" as const, followingOutputId: "projector" },
    },
  },
  undoable: {
    present: {
      itemLists: {
        currentLists: outlineLists,
        selectedIdByScope: { presentation: "outline-1", aux: "outline-aux" },
      },
    },
  },
};

jest.mock("../../hooks", () => ({
  useSelector: (selector: (value: typeof state) => unknown) => selector(state),
}));

jest.mock("../../context/activeController", () => ({
  useActiveControllerProfile: () => activeProfile,
}));

jest.mock("../../hooks/useServiceVideoCandidates", () => ({
  useServiceVideoCandidates: (options: Record<string, unknown>) => {
    discoverMedia(options);
    return {
      posterUrls: ["https://cdn.example.com/opening.jpg"],
      discovery: {
        renderer: "projector",
        controllerProfileId: options.controllerProfileId,
        outlineScope: options.outlineScope,
        outlineId: options.outlineId,
        outlineLoadState: "loaded",
        items: [],
        itemCount: 0,
        uniqueFiniteVideoCount: 0,
      },
    };
  },
}));

jest.mock("../../hooks/useMediaPreparationManifest", () => ({
  usePublishMediaPreparationManifest: (options: unknown) => {
    publishManifest(options);
  },
}));

const renderPublisher = (db?: object) =>
  render(
    <GlobalInfoContext.Provider value={{ sessionKind: "human" } as never}>
      <ControllerInfoContext.Provider value={{ db } as never}>
        <ControllerMediaPreparationPublisher />
      </ControllerInfoContext.Provider>
    </GlobalInfoContext.Provider>,
  );

describe("ControllerMediaPreparationPublisher", () => {
  beforeEach(() => {
    activeProfile = profile;
    state = {
      ...state,
      controllerProfiles: { list: [profile, auxProfile] },
      presentation: {
        outputs: {
          projector: { id: "projector", type: "projector" as const },
          monitor: { id: "monitor", type: "monitor" as const },
          stream: { id: "stream", type: "stream" as const },
          tvs: { id: "tvs", type: "projector" as const, followingOutputId: "projector" },
        },
      },
    };
    state.undoable.present.itemLists.currentLists = outlineLists;
    state.undoable.present.itemLists.selectedIdByScope = {
      presentation: "outline-1",
      aux: "outline-aux",
    };
    publishManifest.mockClear();
    discoverMedia.mockClear();
    mockPublishPreparedContext.mockClear();
    mockSubscribePreparedContextRequests.mockClear();
  });

  it("discovers once for projector, monitor, and stream while publishing three manifests", async () => {
    renderPublisher();

    await waitFor(() => expect(publishManifest).toHaveBeenCalledTimes(3));
    expect(discoverMedia).toHaveBeenCalledTimes(1);
    expect(discoverMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        cacheMedia: false,
        outlineId: "outline-1",
        controllerProfileId: "presentation",
      }),
    );
    expect(publishManifest.mock.calls.map(([options]) => options.outputId).sort()).toEqual([
      "monitor",
      "projector",
      "stream",
    ]);
    expect(mockPublishPreparedContext).toHaveBeenCalledTimes(1);
    expect(mockPublishPreparedContext).toHaveBeenCalledWith({
      controllerProfileId: "presentation",
      controllerProfileName: "Main",
      outlineScope: "presentation",
      outlineId: "outline-1",
      outlineName: "Sunday",
      contextSource: "local runtime selection",
    });
    expect(mockSubscribePreparedContextRequests).toHaveBeenCalledTimes(1);
    const getCurrentContexts = mockSubscribePreparedContextRequests.mock.calls[0][0] as () => unknown[];
    expect(getCurrentContexts()).toEqual([
      expect.objectContaining({ controllerProfileId: "presentation", outlineId: "outline-1" }),
    ]);
  });

  it("publishes selected outline changes and name updates without picker interaction", async () => {
    const view = renderPublisher();
    await waitFor(() => expect(mockPublishPreparedContext).toHaveBeenCalledTimes(1));

    state = {
      ...state,
      undoable: {
        present: {
          itemLists: {
            currentLists: [
              { ...outlineLists[0], name: "Sabbath Service" },
              outlineLists[1],
            ],
            selectedIdByScope: { presentation: "outline-1", aux: "outline-aux" },
          },
        },
      },
    };
    view.rerender(
      <GlobalInfoContext.Provider value={{ sessionKind: "human" } as never}>
        <ControllerMediaPreparationPublisher />
      </GlobalInfoContext.Provider>,
    );

    await waitFor(() => expect(mockPublishPreparedContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ outlineId: "outline-1", outlineName: "Sabbath Service" }),
    ));
    state = {
      ...state,
      undoable: {
        present: {
          itemLists: {
            currentLists: [
              { ...outlineLists[0], name: "Sabbath Service" },
              { ...outlineLists[0], _id: "outline-2", name: "Next Service" },
            ],
            selectedIdByScope: { presentation: "outline-2", aux: "outline-aux" },
          },
        },
      },
    };
    view.rerender(
      <GlobalInfoContext.Provider value={{ sessionKind: "human" } as never}>
        <ControllerMediaPreparationPublisher />
      </GlobalInfoContext.Provider>,
    );
    await waitFor(() => expect(mockPublishPreparedContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ outlineId: "outline-2", outlineName: "Next Service" }),
    ));
    const getCurrentContexts = mockSubscribePreparedContextRequests.mock.calls.at(-1)?.[0] as (() => unknown[]) | undefined;
    expect(getCurrentContexts?.()).toEqual([
      expect.objectContaining({ outlineId: "outline-2", outlineName: "Next Service" }),
    ]);
  });

  it("publishes only the Aux controller's scoped outline when mounted for Aux", async () => {
    const view = renderPublisher();
    await waitFor(() => expect(mockPublishPreparedContext).toHaveBeenCalledTimes(1));
    activeProfile = auxProfile;
    state.presentation.outputs.tvs.followingOutputId = "";
    view.rerender(
      <GlobalInfoContext.Provider value={{ sessionKind: "human" } as never}>
        <ControllerMediaPreparationPublisher />
      </GlobalInfoContext.Provider>,
    );

    await waitFor(() => expect(mockPublishPreparedContext).toHaveBeenCalledWith(
      expect.objectContaining({
        controllerProfileId: "aux",
        outlineScope: "aux",
        outlineId: "outline-aux",
      }),
    ));
    expect(mockPublishPreparedContext).toHaveBeenCalledTimes(2);
  });

  it("does not republish when controller state rerenders without an effective context change", async () => {
    const view = renderPublisher();
    await waitFor(() => expect(mockPublishPreparedContext).toHaveBeenCalledTimes(1));
    view.rerender(
      <GlobalInfoContext.Provider value={{ sessionKind: "human" } as never}>
        <ControllerInfoContext.Provider value={{ db: undefined } as never}>
          <ControllerMediaPreparationPublisher />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );
    expect(mockPublishPreparedContext).toHaveBeenCalledTimes(1);
  });

  it("publishes again when the controller DB channel becomes ready", async () => {
    const view = renderPublisher();
    await waitFor(() => expect(mockPublishPreparedContext).toHaveBeenCalledTimes(1));
    view.rerender(
      <GlobalInfoContext.Provider value={{ sessionKind: "human" } as never}>
        <ControllerInfoContext.Provider value={{ db: {} } as never}>
          <ControllerMediaPreparationPublisher />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    await waitFor(() => expect(mockPublishPreparedContext).toHaveBeenCalledTimes(2));
  });

  it("publishes a mirrored TVs manifest from the presentation source outline", async () => {
    activeProfile = auxProfile;
    renderPublisher();

    await waitFor(() => expect(publishManifest).toHaveBeenCalledTimes(1));
    expect(discoverMedia).toHaveBeenCalledTimes(1);
    expect(discoverMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        outlineId: "outline-1",
        outlineScope: "presentation",
        controllerProfileId: "presentation",
      }),
    );
    expect(publishManifest).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, outputId: "tvs" }),
    );
  });

  it("returns a stopped mirror to the aux outline and discovers separate source groups", async () => {
    activeProfile = {
      ...profile,
      outputIds: ["projector", "monitor", "stream", "tvs"],
      outputsConfigured: true,
    };
    state = {
      ...state,
      controllerProfiles: {
        list: [
          { ...auxProfile, outputIds: ["monitor", "tvs"], outputsConfigured: true },
          activeProfile,
        ],
      },
      presentation: {
        outputs: {
          projector: { id: "projector", type: "projector" as const },
          monitor: { id: "monitor", type: "monitor" as const },
          stream: { id: "stream", type: "stream" as const },
          tvs: { id: "tvs", type: "projector" as const, followingOutputId: "" },
        },
      },
    };
    renderPublisher();

    await waitFor(() => expect(discoverMedia).toHaveBeenCalledTimes(2));
    expect(discoverMedia.mock.calls.map(([options]) => options.outlineId).sort()).toEqual([
      "outline-1",
      "outline-aux",
    ]);
    expect(publishManifest).toHaveBeenCalledTimes(4);
    expect(publishManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        outputId: "tvs",
        discovery: expect.objectContaining({ outlineId: "outline-aux" }),
      }),
    );
  });

  it("prefetches browser posters once per source group", async () => {
    const image = { decoding: "", src: "", onload: null, onerror: null };
    const imageSpy = jest
      .spyOn(global, "Image")
      .mockImplementation(() => image as unknown as HTMLImageElement);
    renderPublisher();

    await waitFor(() => expect(discoverMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(imageSpy).toHaveBeenCalledTimes(1));
    imageSpy.mockRestore();
  });
});
