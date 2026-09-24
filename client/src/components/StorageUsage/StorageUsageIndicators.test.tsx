import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getChurchStorageQuota } from "../../api/auth";
import type { ChurchStorageQuotaUsage } from "../../api/authTypes";
import { StorageUsageIndicators } from "./StorageUsageIndicators";
import { useChurchStorageQuota } from "./useChurchStorageQuota";
import { formatStorageBytes, formatStorageMinutes } from "./storageUsageFormatting";

jest.mock("../../api/auth", () => ({
  ...jest.requireActual("../../api/auth"),
  getChurchStorageQuota: jest.fn(),
}));

const mockGetQuota = jest.mocked(getChurchStorageQuota);

const quotas: ChurchStorageQuotaUsage = {
  r2: { used: 3.5 * 1024 ** 2, limit: 500 * 1024 ** 2, unit: "bytes" },
  cloudinary: { used: 400 * 1024 ** 2, limit: 500 * 1024 ** 2, unit: "bytes" },
  mux: { used: 780, limit: 2_000, unit: "minutes" },
};

const QuotaHarness = ({ churchId }: { churchId: string }) => {
  const quota = useChurchStorageQuota(churchId);
  return (
    <StorageUsageIndicators
      status={quota.status}
      quotas={quota.quotas}
      providers={["r2"]}
      onRetry={quota.refresh}
    />
  );
};

describe("storage usage formatting and indicators", () => {
  beforeEach(() => mockGetQuota.mockReset());

  it("formats bytes and minutes consistently", () => {
    expect(formatStorageBytes(0)).toBe("0 B");
    expect(formatStorageBytes(3.5 * 1024 ** 2)).toBe("3.5 MB");
    expect(formatStorageBytes(500 * 1024 ** 2)).toBe("500 MB");
    expect(formatStorageMinutes(2_000)).toBe("2,000 min");
  });

  it("renders R2, Cloudinary and Mux values in their requested locations and units", () => {
    render(
      <StorageUsageIndicators
        status="ready"
        quotas={quotas}
        providers={["r2", "cloudinary", "mux"]}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.queryByRole("region", { name: "File storage" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show storage usage details" }));
    expect(screen.getByRole("region", { name: "File storage" })).toHaveTextContent("3.5 MB / 500 MB");
    expect(screen.getByRole("region", { name: "Image storage (Cloudinary)" })).toHaveTextContent("400 MB / 500 MB");
    expect(screen.getByRole("region", { name: "Video storage (Mux)" })).toHaveTextContent("780 min / 2,000 min");
    expect(screen.getByText("496.5 MB remaining")).toBeInTheDocument();
    expect(screen.getByText("100 MB remaining")).toBeInTheDocument();
    expect(screen.getByText("1,220 min remaining")).toBeInTheDocument();
  });

  it("shows zero remaining at a full quota and preserves over-limit amounts", () => {
    const fullAndOver: ChurchStorageQuotaUsage = {
      ...quotas,
      r2: { used: 500 * 1024 ** 2, limit: 500 * 1024 ** 2, unit: "bytes" },
      cloudinary: { used: 600 * 1024 ** 2, limit: 500 * 1024 ** 2, unit: "bytes" },
    };
    render(
      <StorageUsageIndicators
        status="ready"
        quotas={fullAndOver}
        providers={["r2", "cloudinary"]}
        onRetry={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show storage usage details" }));
    expect(screen.getByRole("region", { name: "File storage" })).toHaveTextContent("500 MB / 500 MB");
    expect(screen.getByRole("region", { name: "File storage" })).toHaveTextContent("Storage full");
    expect(screen.getByRole("region", { name: "Image storage (Cloudinary)" })).toHaveTextContent("600 MB / 500 MB");
    expect(screen.getByRole("region", { name: "Image storage (Cloudinary)" })).toHaveTextContent("Over limit");
    expect(screen.getByRole("progressbar", { name: "Image storage (Cloudinary) usage" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders zero usage compactly and stacks indicators only below the responsive breakpoint", () => {
    const zeroUsage: ChurchStorageQuotaUsage = {
      ...quotas,
      r2: { used: 0, limit: 2 * 1024 ** 3, unit: "bytes" },
    };
    render(
      <StorageUsageIndicators
        status="ready"
        quotas={zeroUsage}
        providers={["r2", "mux"]}
        onRetry={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show storage usage details" }));
    expect(screen.getByRole("region", { name: "File storage" })).toHaveTextContent("0 B / 2 GB");
    expect(screen.getByRole("region", { name: "File storage" })).toHaveTextContent("2 GB remaining");
    expect(screen.getByRole("group", { name: "Storage usage" })).toHaveClass("grid-cols-1", "sm:grid-cols-2");
  });

  it("shows loading, reports API errors and retries for the current church", async () => {
    mockGetQuota.mockRejectedValueOnce(new Error("offline"));
    mockGetQuota.mockResolvedValueOnce({ success: true, quotas });
    render(<QuotaHarness churchId="church-1" />);
    expect(screen.getByText("Loading storage usage...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show storage usage details" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show storage usage details" }));
    expect(screen.getByRole("group", { name: "Storage usage" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("region", { name: "File storage loading" })).toBeInTheDocument();
    expect(await screen.findByText("Storage usage unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show storage usage details" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("region", { name: "File storage" })).toHaveTextContent("3.5 MB / 500 MB");
    expect(mockGetQuota).toHaveBeenCalledTimes(2);
    expect(mockGetQuota).toHaveBeenNthCalledWith(2, "church-1");
  });

  it("does not show a previous church's usage or apply its stale response", async () => {
    let resolveFirst!: (value: { success: boolean; quotas: ChurchStorageQuotaUsage }) => void;
    const first = new Promise<{ success: boolean; quotas: ChurchStorageQuotaUsage }>((resolve) => { resolveFirst = resolve; });
    mockGetQuota.mockReturnValueOnce(first);
    mockGetQuota.mockResolvedValueOnce({
      success: true,
      quotas: { ...quotas, r2: { used: 9 * 1024 ** 2, limit: 100 * 1024 ** 2, unit: "bytes" } },
    });
    const { rerender } = render(<QuotaHarness churchId="church-1" />);
    await waitFor(() => expect(mockGetQuota).toHaveBeenCalledWith("church-1"));
    rerender(<QuotaHarness churchId="church-2" />);
    expect(screen.queryByText("3.5 MB / 500 MB")).not.toBeInTheDocument();
    resolveFirst({ success: true, quotas });
    expect(await screen.findByRole("region", { name: "File storage" })).toHaveTextContent("9 MB / 100 MB");
    expect(screen.queryByText("3.5 MB")).not.toBeInTheDocument();
    expect(mockGetQuota).toHaveBeenLastCalledWith("church-2");
  });
});
