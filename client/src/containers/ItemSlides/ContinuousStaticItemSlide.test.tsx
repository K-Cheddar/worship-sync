import { render, screen } from "@testing-library/react";
import type { ItemSlideType } from "../../types";
import ContinuousStaticItemSlide from "./ContinuousStaticItemSlide";

jest.mock("./StaticSlideThumbnail", () => ({
  __esModule: true,
  default: ({ slide }: { slide: { name: string } }) => (
    <div data-testid="static-slide-thumbnail">{slide.name}</div>
  ),
}));

jest.mock("../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: () => ({
    isLocalImage: false,
    isOwner: false,
    status: "not-local",
    url: undefined,
  }),
}));

const slide: ItemSlideType = {
  id: "remote-camera-slide",
  name: "Camera",
  type: "Verse",
  boxes: [],
  mediaSource: {
    kind: "local-video-input",
    sourceId: "remote-camera",
    label: "Main camera",
    ownerDeviceId: "remote-device",
    ownerLabel: "Booth PC",
  },
};

describe("ContinuousStaticItemSlide unavailable capture presentation", () => {
  it("keeps the thumbnail tile isolated and avoids a duplicate capture badge", () => {
    render(
      <ul>
        <ContinuousStaticItemSlide
          slide={slide}
          index={0}
          itemType="song"
          previewMode="projector"
          isLive={false}
          onSlideGridClick={jest.fn()}
          slideDomId="continuous-camera-slide"
        />
      </ul>,
    );

    expect(screen.getByRole("button", { name: "Camera" })).toHaveClass(
      "isolate",
    );
    expect(screen.getByTestId("static-slide-thumbnail")).toBeInTheDocument();
    expect(
      screen.queryByTestId("local-video-input-slide-badge"),
    ).not.toBeInTheDocument();
  });
});
