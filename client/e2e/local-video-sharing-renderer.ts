import {
  acquireWarmLocalVideoCapture,
  releaseWarmLocalVideoCapture,
} from "../src/utils/localVideoCapturePool";

// The real preload exposes this marker; the isolated fixture has no app IPC.
window.__ELECTRON__ = true;
const videos = new Map<string, HTMLVideoElement>();
const relayWork = { VideoEncoder: 0, VideoDecoder: 0, MediaRecorder: 0 };
for (const name of Object.keys(relayWork) as (keyof typeof relayWork)[]) {
  const constructor = Reflect.get(window, name);
  if (typeof constructor !== "function") continue;
  Object.defineProperty(window, name, { configurable: true, value: new Proxy(constructor, {
    construct(target, args) {
      relayWork[name]++;
      return Reflect.construct(target, args);
    },
  }) });
}
Object.assign(window, {
  relayWork,
  configureHighResolutionHost() {
    // Exercise a host already delivering above the client's 1080p preference.
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => getUserMedia({
      ...constraints, video: { ...(constraints?.video as MediaTrackConstraints),
        width: { exact: 3_840 }, height: { exact: 2_160 } },
    });
  },
  captureSize(consumer: string) {
    const video = videos.get(consumer);
    return { width: video?.videoWidth, height: video?.videoHeight };
  },
  async startCapture(consumer: string, publish = false) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const device = devices.find((item) => item.kind === "videoinput");
    if (!device) throw new Error("Fake camera missing");
    const { stream } = await acquireWarmLocalVideoCapture("test-camera", {
      sourceId: "test-camera", deviceId: device.deviceId, deviceLabel: device.label,
    }, publish, consumer, { shared: !publish });
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    document.body.append(video);
    videos.set(consumer, video);
    await video.play();
    await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
    return stream.getVideoTracks()[0].getSettings();
  },
  async nextFrame(consumer: string) {
    const video = videos.get(consumer);
    if (!video) throw new Error("Video missing");
    return new Promise<number>((resolve) => {
      video.requestVideoFrameCallback((_now, metadata) => resolve(metadata.presentedFrames));
    });
  },
  async releaseCapture(consumer: string) {
    await releaseWarmLocalVideoCapture("test-camera", consumer);
    videos.get(consumer)?.remove();
    videos.delete(consumer);
  },
});
