import {
  claimMediaDeletion,
  claimMediaUpload,
  MediaOperationCleanupError,
} from "./mediaOperationClaims";

describe("media operation claims", () => {
  it("stops an upload and waits for it to release before deletion proceeds", async () => {
    const upload = claimMediaUpload("media-delete-race");
    expect(upload).not.toBeNull();
    let releaseUpload!: () => void;
    const uploadCleanup = new Promise<void>((resolve) => { releaseUpload = resolve; });
    let cancellationStarted = false;
    upload!.setCancel(async () => {
      cancellationStarted = true;
      await uploadCleanup;
      upload!.release();
    });

    const deletion = claimMediaDeletion(["media-delete-race"]);
    let deletionReady = false;
    const waiting = deletion.waitForUploads().then(() => { deletionReady = true; });
    await Promise.resolve();
    expect(cancellationStarted).toBe(true);
    expect(deletionReady).toBe(false);

    releaseUpload();
    await waiting;
    expect(deletionReady).toBe(true);
    deletion.release();
  });

  it("allows unrelated media to proceed independently", async () => {
    const upload = claimMediaUpload("unrelated-upload");
    const cancel = jest.fn();
    upload!.setCancel(cancel);
    const deletion = claimMediaDeletion(["unrelated-delete"]);

    await deletion.waitForUploads();
    expect(cancel).not.toHaveBeenCalled();
    expect(upload!.isCurrent()).toBe(true);

    deletion.release();
    upload!.release();
  });

  it("returns cleanup retry details when upload cancellation fails", async () => {
    const upload = claimMediaUpload("media-cleanup-failure");
    const retryCleanup = jest.fn(async () => undefined);
    upload!.failCleanup(new Error("Mux cleanup failed."), retryCleanup);
    upload!.setCancel(async () => { throw new Error("Mux cleanup failed."); });
    const deletion = claimMediaDeletion(["media-cleanup-failure"]);
    upload!.release();

    await expect(deletion.waitForUploads()).rejects.toMatchObject<Partial<MediaOperationCleanupError>>({
      message: "Mux cleanup failed.",
      retryCleanup,
    });
    deletion.release();
  });

  it("serializes two deletions of the same media", async () => {
    const first = claimMediaDeletion(["same-delete"]);
    const second = claimMediaDeletion(["same-delete"]);
    let secondReady = false;
    const waiting = second.waitForUploads().then(() => { secondReady = true; });
    await Promise.resolve();
    expect(secondReady).toBe(false);

    first.release();
    await waiting;
    expect(secondReady).toBe(true);
    second.release();
  });
});
