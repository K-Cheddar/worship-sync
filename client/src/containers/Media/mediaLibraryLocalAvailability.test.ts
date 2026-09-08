import type { MediaType } from "../../types";
import {
  canRequestLocalMediaCloudUpload,
  canUploadLocalMediaToCloud,
  getLocalMediaOwnerDeviceId,
  getLocalMediaOwnerLabel,
  getNextOwnedCloudUploadPrompt,
  isLocalMediaVisibleByDefault,
  localMediaHasCloudCopy,
} from "./mediaLibraryLocalAvailability";

const deviceId = "this-device";

const ownedImage = (overrides: Partial<MediaType> = {}): MediaType => ({
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "png",
  height: 1080,
  width: 1920,
  name: "slide.png",
  publicId: "local_image_1",
  type: "image",
  id: "local_image_1",
  background: "local-image://local_image_1",
  thumbnail: "",
  source: "local",
  localImage: {
    id: "local_image_1",
    ownerDeviceId: deviceId,
    ownerLabel: "Booth PC",
    fileName: "slide.png",
    contentType: "image/png",
    storagePolicy: "local-only",
  },
  ...overrides,
});

describe("mediaLibraryLocalAvailability", () => {
  it("hides other-device local files that have no cloud copy", () => {
    const remote = ownedImage({
      localImage: {
        id: "local_image_2",
        ownerDeviceId: "other-device",
        ownerLabel: "Laptop",
        fileName: "slide.png",
        contentType: "image/png",
        storagePolicy: "local-only",
      },
    });
    expect(isLocalMediaVisibleByDefault(remote, deviceId)).toBe(false);
    expect(canRequestLocalMediaCloudUpload(remote, deviceId)).toBe(true);
    expect(canUploadLocalMediaToCloud(remote, deviceId)).toBe(false);
  });

  it("shows other-device images after a cloud copy exists", () => {
    const remote = ownedImage({
      localImage: {
        id: "local_image_2",
        ownerDeviceId: "other-device",
        ownerLabel: "Laptop",
        fileName: "slide.png",
        contentType: "image/png",
        storagePolicy: "local-and-cloud",
        cloudUrl: "https://res.cloudinary.com/example/slide.png",
      },
    });
    expect(localMediaHasCloudCopy(remote)).toBe(true);
    expect(isLocalMediaVisibleByDefault(remote, deviceId)).toBe(true);
    expect(canRequestLocalMediaCloudUpload(remote, deviceId)).toBe(false);
  });

  it("lets the owner upload a local file they still hold", () => {
    const local = ownedImage();
    expect(isLocalMediaVisibleByDefault(local, deviceId)).toBe(true);
    expect(canUploadLocalMediaToCloud(local, deviceId)).toBe(true);
    expect(canRequestLocalMediaCloudUpload(local, deviceId)).toBe(false);
  });

  it("hides other-device video inputs and never offers a cloud upload", () => {
    const input: MediaType = ownedImage({
      id: "input-1",
      type: "video",
      format: "live",
      localImage: undefined,
      localVideoInput: {
        kind: "local-video-input",
        sourceId: "src-1",
        label: "USB Capture",
        ownerDeviceId: "other-device",
        ownerLabel: "Booth PC",
      },
    });
    expect(isLocalMediaVisibleByDefault(input, deviceId)).toBe(false);
    expect(canUploadLocalMediaToCloud(input, deviceId)).toBe(false);
    expect(canRequestLocalMediaCloudUpload(input, deviceId)).toBe(false);
    expect(getLocalMediaOwnerDeviceId(input)).toBe("other-device");
    expect(getLocalMediaOwnerLabel(input)).toBe("Booth PC");
  });

  it("keeps legacy local items without an owner visible everywhere", () => {
    const legacy = ownedImage({
      localImage: undefined,
      source: "local",
    });
    expect(isLocalMediaVisibleByDefault(legacy, deviceId)).toBe(true);
  });

  it("prompts the owner with the oldest pending upload request", () => {
    const later = ownedImage({
      id: "later",
      name: "later.png",
      cloudUploadRequest: {
        requestedAt: "2026-08-17T12:00:00.000Z",
        requestedByDeviceId: "other",
        requestedByLabel: "Laptop",
      },
    });
    const earlier = ownedImage({
      id: "earlier",
      name: "earlier.png",
      cloudUploadRequest: {
        requestedAt: "2026-08-17T11:00:00.000Z",
        requestedByDeviceId: "other",
        requestedByLabel: "Laptop",
      },
    });
    expect(getNextOwnedCloudUploadPrompt([later, earlier], deviceId)?.id).toBe(
      "earlier",
    );
    expect(getNextOwnedCloudUploadPrompt([later], "other-device")).toBe(
      undefined,
    );
  });
});
