import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrandingForm } from "./AccountFormSections";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ToastContext } from "../../context/toastContext";
import { createMockGlobalContext } from "../../test/mocks";
import * as authApi from "../../api/auth";
import * as cloudinaryUpload from "../../containers/Media/utils/cloudinaryUpload";
import * as cloudinaryUtils from "../../utils/cloudinaryUtils";

jest.mock("../../api/auth", () => ({
  ...jest.requireActual("../../api/auth"),
  updateChurchBranding: jest.fn(),
}));

jest.mock("../../containers/Media/utils/cloudinaryUpload", () => ({
  uploadImageToCloudinary: jest.fn(),
}));

jest.mock("../../utils/cloudinaryUtils", () => ({
  ...jest.requireActual("../../utils/cloudinaryUtils"),
  deleteFromCloudinary: jest.fn(() => Promise.resolve(true)),
}));

const renderBrandingForm = (brandingOverride?: any) => {
  const branding = brandingOverride || {
    mission: "Old mission",
    vision: "",
    logos: {
      square: {
        url: "https://res.cloudinary.com/portable-media/image/upload/v1/branding/old-square.png",
        publicId: "branding/old-square",
        format: "png",
      },
      wide: null,
    },
    colors: [],
  };
  const showToast = jest.fn();

  render(
    <ToastContext.Provider value={{ showToast, removeToast: jest.fn() }}>
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            churchBranding: branding,
            churchBrandingStatus: "ready",
          }) as any
        }
      >
        <BrandingForm
          churchId="church-1"
          branding={branding}
          brandingStatus="ready"
          uploadPreset="bpqu4ma5"
        />
      </GlobalInfoContext.Provider>
    </ToastContext.Provider>,
  );

  return { showToast, branding };
};

describe("BrandingForm", () => {
  const createObjectUrlMock = jest.fn(() => "blob:test-logo");
  const revokeObjectUrlMock = jest.fn();

  beforeAll(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectUrlMock,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uploads a replacement logo, saves branding, and cleans up the replaced logo", async () => {
    const { showToast } = renderBrandingForm();

    (cloudinaryUpload.uploadImageToCloudinary as jest.Mock).mockResolvedValue({
      public_id: "branding/new-square",
      secure_url:
        "https://res.cloudinary.com/portable-media/image/upload/v1/branding/new-square.png",
      url: "https://res.cloudinary.com/portable-media/image/upload/v1/branding/new-square.png",
      width: 640,
      height: 640,
      format: "png",
    });
    (authApi.updateChurchBranding as jest.Mock).mockResolvedValue({
      success: true,
    });

    fireEvent.change(screen.getByLabelText(/Mission/i), {
      target: { value: "Updated mission" },
    });

    const file = new File(["logo"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Square logo file"), {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));

    await waitFor(() =>
      expect(cloudinaryUpload.uploadImageToCloudinary).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(authApi.updateChurchBranding).toHaveBeenCalledWith(
        "church-1",
        expect.objectContaining({
          mission: "Updated mission",
          logos: expect.objectContaining({
            square: expect.objectContaining({
              publicId: "branding/new-square",
            }),
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(cloudinaryUtils.deleteFromCloudinary).toHaveBeenCalledWith(
        expect.anything(),
        "branding/old-square",
        "image",
      ),
    );
    expect(showToast).toHaveBeenCalledWith("Branding saved.", "success");
  });

  it("cleans up newly uploaded logos when the branding save fails", async () => {
    const { showToast } = renderBrandingForm({
      mission: "",
      vision: "",
      logos: { square: null, wide: null },
      colors: [],
    });

    (cloudinaryUpload.uploadImageToCloudinary as jest.Mock).mockResolvedValue({
      public_id: "branding/unsaved-square",
      secure_url:
        "https://res.cloudinary.com/portable-media/image/upload/v1/branding/unsaved-square.png",
      url: "https://res.cloudinary.com/portable-media/image/upload/v1/branding/unsaved-square.png",
      width: 640,
      height: 640,
      format: "png",
    });
    (authApi.updateChurchBranding as jest.Mock).mockRejectedValue(
      new Error("Save failed"),
    );

    const file = new File(["logo"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Square logo file"), {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));

    await waitFor(() =>
      expect(authApi.updateChurchBranding).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(cloudinaryUtils.deleteFromCloudinary).toHaveBeenCalledWith(
        expect.anything(),
        "branding/unsaved-square",
        "image",
      ),
    );
    expect(showToast).toHaveBeenCalledWith("Save failed", "error");
  });

  it("keeps an intentionally selected unlabeled white brand color", async () => {
    renderBrandingForm({
      mission: "",
      vision: "",
      logos: { square: null, wide: null },
      colors: [],
    });

    (authApi.updateChurchBranding as jest.Mock).mockResolvedValue({
      success: true,
    });

    const colorButtons = screen.getAllByRole("button", { name: "#FFFFFF" });
    fireEvent.click(colorButtons[0]);

    const colorInput = screen.getByDisplayValue("#FFFFFF");
    fireEvent.change(colorInput, { target: { value: "#000000" } });
    fireEvent.change(colorInput, { target: { value: "#FFFFFF" } });

    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));

    await waitFor(() =>
      expect(authApi.updateChurchBranding).toHaveBeenCalledWith(
        "church-1",
        expect.objectContaining({
          colors: [{ value: "#FFFFFF" }],
        }),
      ),
    );
  });

  it("saves unlabeled white when the user only opens the color picker on an empty slot", async () => {
    renderBrandingForm({
      mission: "",
      vision: "",
      logos: { square: null, wide: null },
      colors: [],
    });

    (authApi.updateChurchBranding as jest.Mock).mockResolvedValue({
      success: true,
    });

    const colorButtons = screen.getAllByRole("button", { name: "#FFFFFF" });
    fireEvent.click(colorButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));

    await waitFor(() =>
      expect(authApi.updateChurchBranding).toHaveBeenCalledWith(
        "church-1",
        expect.objectContaining({
          colors: [{ value: "#FFFFFF" }],
        }),
      ),
    );
  });
});
