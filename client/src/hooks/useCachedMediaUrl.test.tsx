import React, { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { useCachedMediaUrl, useCachedVideoUrl } from "./useCachedMediaUrl";

type HookMode = "media" | "video";

const HookProbe = ({
  url,
  mode,
  onValue,
}: {
  url: string | undefined;
  mode: HookMode;
  onValue: (value: string | undefined) => void;
}) => {
  const mediaValue = useCachedMediaUrl(mode === "media" ? url : undefined);
  const videoValue = useCachedVideoUrl(mode === "video" ? url : undefined);
  const value = mode === "video" ? videoValue : mediaValue;

  useEffect(() => {
    onValue(value);
  }, [onValue, value]);

  return <div data-testid="value">{value ?? "undefined"}</div>;
};

describe("useCachedMediaUrl hooks", () => {
  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
    jest.clearAllMocks();
  });

  it("returns original url when electron api is unavailable", () => {
    const onValue = jest.fn();
    render(<HookProbe url="https://cdn.example.com/image.jpg" mode="media" onValue={onValue} />);

    expect(screen.getByTestId("value")).toHaveTextContent(
      "https://cdn.example.com/image.jpg",
    );
  });

  it("resolves to local media path when electron cache returns one", async () => {
    (window as { electronAPI?: unknown }).electronAPI = {
      getLocalMediaPath: jest.fn().mockResolvedValue("/cache/image.jpg"),
    };
    const onValue = jest.fn();

    render(<HookProbe url="https://cdn.example.com/image.jpg" mode="media" onValue={onValue} />);

    await waitFor(() =>
      expect(screen.getByTestId("value")).toHaveTextContent("/cache/image.jpg"),
    );
    expect(onValue).toHaveBeenCalledWith("/cache/image.jpg");
  });

  it("ignores stale async media results when url changes quickly", async () => {
    let resolveFirst: (value: string | null) => void = () => {};
    let resolveSecond: (value: string | null) => void = () => {};
    const getLocalMediaPath = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    (window as { electronAPI?: unknown }).electronAPI = { getLocalMediaPath };

    const onValue = jest.fn();
    const { rerender } = render(
      <HookProbe url="https://cdn.example.com/one.jpg" mode="media" onValue={onValue} />,
    );

    rerender(
      <HookProbe url="https://cdn.example.com/two.jpg" mode="media" onValue={onValue} />,
    );

    resolveFirst("/cache/one.jpg");
    resolveSecond("/cache/two.jpg");

    await waitFor(() =>
      expect(screen.getByTestId("value")).toHaveTextContent("/cache/two.jpg"),
    );
    expect(screen.getByTestId("value")).not.toHaveTextContent("/cache/one.jpg");
  });

  it("returns undefined while video cache url is resolving", async () => {
    let resolvePath: (value: string | null) => void = () => {};
    (window as { electronAPI?: unknown }).electronAPI = {
      getLocalMediaPath: jest.fn().mockImplementation(
        () =>
          new Promise<string | null>((resolve) => {
            resolvePath = resolve;
          }),
      ),
    };

    const onValue = jest.fn();
    render(<HookProbe url="https://cdn.example.com/clip.mp4" mode="video" onValue={onValue} />);

    expect(screen.getByTestId("value")).toHaveTextContent("undefined");
    resolvePath("/cache/clip.mp4");

    await waitFor(() =>
      expect(screen.getByTestId("value")).toHaveTextContent("/cache/clip.mp4"),
    );
  });
});
