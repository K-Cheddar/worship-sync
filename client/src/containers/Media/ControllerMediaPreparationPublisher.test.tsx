import { render, waitFor } from "@testing-library/react";
import { GlobalInfoContext } from "../../context/globalInfo";
import ControllerMediaPreparationPublisher from "./ControllerMediaPreparationPublisher";
import type { ControllerProfile } from "../../utils/controllerProfiles";

const publishManifest = jest.fn();
const discoverMedia = jest.fn();

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

const renderPublisher = () =>
  render(
    <GlobalInfoContext.Provider value={{ sessionKind: "human" } as never}>
      <ControllerMediaPreparationPublisher />
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
    publishManifest.mockClear();
    discoverMedia.mockClear();
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
