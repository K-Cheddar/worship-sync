import {
  MAX_VISIBLE_TOASTS,
  appendToast,
  findToastEvictionIndex,
  isDuplicateToast,
} from "./toastQueue";
import type { ToastData } from "./ToastContainer";

const toast = (
  partial: Partial<ToastData> & Pick<ToastData, "id">,
): ToastData => partial;

describe("toastQueue", () => {
  describe("isDuplicateToast", () => {
    it("matches on message, variant, and position", () => {
      expect(
        isDuplicateToast(
          toast({ id: "a", message: "Saved", variant: "success" }),
          toast({ id: "b", message: "Saved", variant: "success" }),
        ),
      ).toBe(true);
    });

    it("does not match different variants or missing messages", () => {
      expect(
        isDuplicateToast(
          toast({ id: "a", message: "Saved", variant: "success" }),
          toast({ id: "b", message: "Saved", variant: "error" }),
        ),
      ).toBe(false);
      expect(
        isDuplicateToast(
          toast({ id: "a", variant: "info" }),
          toast({ id: "b", message: "Hello", variant: "info" }),
        ),
      ).toBe(false);
    });
  });

  describe("findToastEvictionIndex", () => {
    it("prefers oldest non-persistent non-error toast", () => {
      expect(
        findToastEvictionIndex([
          toast({ id: "1", message: "ok", variant: "success" }),
          toast({ id: "2", message: "fail", variant: "error" }),
          toast({ id: "3", message: "stay", persist: true, variant: "error" }),
        ]),
      ).toBe(0);
    });

    it("falls back to oldest non-persistent error, then oldest overall", () => {
      expect(
        findToastEvictionIndex([
          toast({ id: "1", message: "fail", variant: "error" }),
          toast({ id: "2", message: "stay", persist: true }),
        ]),
      ).toBe(0);

      expect(
        findToastEvictionIndex([
          toast({ id: "1", message: "a", persist: true }),
          toast({ id: "2", message: "b", persist: true }),
        ]),
      ).toBe(0);
    });
  });

  describe("appendToast", () => {
    it("replaces an identical message instead of stacking a duplicate", () => {
      const result = appendToast(
        [toast({ id: "old", message: "Saved.", variant: "success" })],
        toast({ id: "new", message: "Saved.", variant: "success" }),
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("new");
    });

    it(`keeps at most ${MAX_VISIBLE_TOASTS} toasts and preserves errors when possible`, () => {
      const result = appendToast(
        [
          toast({ id: "1", message: "One", variant: "success" }),
          toast({ id: "2", message: "Two", variant: "info" }),
          toast({ id: "3", message: "Fail", variant: "error" }),
        ],
        toast({ id: "4", message: "Three", variant: "success" }),
      );

      expect(result.map((item) => item.id)).toEqual(["2", "3", "4"]);
    });

    it("evicts the oldest soft toast before a persistent toast", () => {
      const result = appendToast(
        [
          toast({ id: "1", message: "Auth", persist: true, variant: "error" }),
          toast({ id: "2", message: "Saved", variant: "success" }),
          toast({ id: "3", message: "Synced", variant: "info" }),
        ],
        toast({ id: "4", message: "Done", variant: "success" }),
      );

      expect(result.map((item) => item.id)).toEqual(["1", "3", "4"]);
    });
  });
});
