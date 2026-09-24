import { render, waitFor } from "@testing-library/react";
import { GlobalInfoContext } from "../../context/globalInfo";
import ControllerMediaPreparationPublisher from "./ControllerMediaPreparationPublisher";
import type { ControllerProfile } from "../../utils/controllerProfiles";

const publishManifest = jest.fn();
const discoverMedia = jest.fn();

const profile: ControllerProfile = {
  id: "presentation",
  type: "presentation" as const,
  name: "Main",
  description: "",
  order: 0,
  enabled: true,
  outputIds: [],
  outputsConfigured: false,
  defaultSendOutputIds: [],
  outlineScope: "presentation",
};

const auxProfile = {
  ...profile,
  id: "aux",
  type: "aux-presentation" as const,
  name: "Lobby",
  outputIds: ["tvs"],
  outputsConfigured: true,
  outlineScope: "aux",
};

let activeProfile = profile;

let state = {
  displayOutputs: {
    list: [
      {
        id: "projector",
        type: "projector" as const,
        name: "Projector",
        order: 0,
        enabled: true,
      },
      {
        id: "tvs",
        type: "projector" as const,
        name: "TVs",
        order: 1,
        enabled: true,
      },
    ],
  },
  controllerProfiles: { list: [profile, auxProfile] },
  presentation: {
    outputs: {
      projector: { id: "projector", type: "projector" as const },
      tvs: {
        id: "tvs",
        type: "projector" as const,
        followingOutputId: "projector",
      },
    },
  },
  undoable: {
    present: {
      itemLists: {
        currentLists: [
          {
            _id: "outline-1",
            name: "Sunday",
            items: [],
            controllerScope: "presentation",
          },
        ],
        selectedIdByScope: { presentation: "outline-1" },
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
  useServiceVideoCandidates: (options: { outputId?: string }) => {
    discoverMedia(options);
    return {
      posterUrls: ["https://cdn.example.com/opening.jpg"],
      discovery: {
        renderer: "projector",
        outputId: options.outputId,
        controllerProfileId: "presentation",
        outlineScope: "presentation",
        outlineId: "outline-1",
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

describe("ControllerMediaPreparationPublisher", () => {
  beforeEach(() => {
    activeProfile = profile;
    publishManifest.mockClear();
    discoverMedia.mockClear();
  });

  it("publishes an owned outline without a mounted audience-output window", async () => {
    render(
      <GlobalInfoContext.Provider value={{ sessionKind: "human" } as never}>
        <ControllerMediaPreparationPublisher />
      </GlobalInfoContext.Provider>,
    );

    await waitFor(() => expect(publishManifest).toHaveBeenCalled());
    expect(discoverMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        cacheMedia: false,
        outputId: "projector",
        outlineId: "outline-1",
      }),
    );
    expect(publishManifest).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, outputId: "projector" }),
    );
  });

  it("publishes the effective source outline for a mirrored output", async () => {
    activeProfile = auxProfile;
    render(
      <GlobalInfoContext.Provider value={{ sessionKind: "human" } as never}>
        <ControllerMediaPreparationPublisher />
      </GlobalInfoContext.Provider>,
    );

    await waitFor(() =>
      expect(discoverMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          outputId: "tvs",
          outlineId: "outline-1",
          outlineScope: "presentation",
          contextSource: "effective mirrored output source",
        }),
      ),
    );
  });
});
