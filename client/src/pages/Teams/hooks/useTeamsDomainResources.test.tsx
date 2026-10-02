import React, { type PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import type { ServicePlanTemplate } from "../../../types/servicePlan";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { createMockGlobalContext } from "../../../test/mocks";
import { listServicePlanTemplates } from "../../../api/auth";
import { useTeamsDomainResources } from "./useTeamsDomainResources";

jest.mock("../../../api/auth", () => ({
  listServicePlanTemplates: jest.fn(),
}));

const mockListTemplates = jest.mocked(listServicePlanTemplates);
const template = (templateId: string, churchId = "church-1"): ServicePlanTemplate => ({
  templateId,
  churchId,
  name: templateId,
  sections: [],
});

describe("useTeamsDomainResources", () => {
  let churchId: string;
  const renderResources = () => renderHook(() => useTeamsDomainResources(), {
    wrapper: ({ children }: PropsWithChildren) => (
      <GlobalInfoContext.Provider
        value={createMockGlobalContext({ churchId }) as React.ContextType<typeof GlobalInfoContext>}
      >
        {children}
      </GlobalInfoContext.Provider>
    ),
  });

  beforeEach(() => {
    churchId = "church-1";
    mockListTemplates.mockReset();
  });

  it("deduplicates concurrent loads and reuses the loaded result", async () => {
    let resolveRequest: ((value: { success: boolean; templates: ServicePlanTemplate[] }) => void) | undefined;
    mockListTemplates.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { result } = renderResources();
    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = result.current.templates.ensureLoaded();
      second = result.current.templates.ensureLoaded();
    });

    expect(mockListTemplates).toHaveBeenCalledTimes(1);
    expect(result.current.templates.loading).toBe(true);
    resolveRequest?.({ success: true, templates: [template("one")] });
    await act(async () => { await Promise.all([first, second]); });

    expect(result.current.templates.data.map(({ templateId }) => templateId)).toEqual(["one"]);
    expect(result.current.templates.loaded).toBe(true);
    await act(async () => { await result.current.templates.ensureLoaded(); });
    expect(mockListTemplates).toHaveBeenCalledTimes(1);
  });

  it("retries a failed initial load and keeps existing data visible during refresh", async () => {
    mockListTemplates
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ success: true, templates: [template("one")] })
      .mockResolvedValueOnce({ success: true, templates: [template("two")] });
    const { result } = renderResources();

    await act(async () => {
      await result.current.templates.ensureLoaded().catch(() => undefined);
    });
    expect(result.current.templates.loaded).toBe(false);
    expect(result.current.templates.error).toBeInstanceOf(Error);

    await act(async () => { await result.current.templates.ensureLoaded(); });
    expect(result.current.templates.data.map(({ templateId }) => templateId)).toEqual(["one"]);

    let resolveRefresh: ((value: { success: boolean; templates: ServicePlanTemplate[] }) => void) | undefined;
    mockListTemplates.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.templates.refresh(); });
    expect(result.current.templates.loading).toBe(true);
    expect(result.current.templates.data.map(({ templateId }) => templateId)).toEqual(["one"]);
    resolveRefresh?.({ success: true, templates: [template("two")] });
    await act(async () => { await refresh; });
    expect(result.current.templates.data.map(({ templateId }) => templateId)).toEqual(["two"]);
  });

  it("discards old-church results and loads the new church independently", async () => {
    const resolvers: Array<(value: { success: boolean; templates: ServicePlanTemplate[] }) => void> = [];
    mockListTemplates.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const { result, rerender } = renderResources();
    let oldRequest!: Promise<void>;
    act(() => { oldRequest = result.current.templates.ensureLoaded(); });

    churchId = "church-2";
    rerender();
    let newRequest!: Promise<void>;
    act(() => { newRequest = result.current.templates.ensureLoaded(); });
    expect(result.current.templates.data).toEqual([]);
    expect(mockListTemplates).toHaveBeenCalledTimes(2);

    resolvers[0]({ success: true, templates: [template("old", "church-1")] });
    await act(async () => { await oldRequest; });
    expect(result.current.templates.data).toEqual([]);

    resolvers[1]({ success: true, templates: [template("new", "church-2")] });
    await act(async () => { await newRequest; });
    expect(result.current.templates.data.map(({ templateId }) => templateId)).toEqual(["new"]);
  });

  it("rejects an old A response after an A to B to A switch", async () => {
    const resolvers: Array<(value: { success: boolean; templates: ServicePlanTemplate[] }) => void> = [];
    mockListTemplates.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const { result, rerender } = renderResources();
    let firstA!: Promise<void>;
    act(() => { firstA = result.current.templates.ensureLoaded(); });

    churchId = "church-2";
    rerender();
    let requestB!: Promise<void>;
    act(() => { requestB = result.current.templates.ensureLoaded(); });

    churchId = "church-1";
    rerender();
    let secondA!: Promise<void>;
    act(() => { secondA = result.current.templates.ensureLoaded(); });
    expect(mockListTemplates).toHaveBeenCalledTimes(3);

    resolvers[2]({ success: true, templates: [template("new-a")] });
    await act(async () => { await secondA; });
    resolvers[0]({ success: true, templates: [template("stale-a")] });
    await act(async () => { await firstA; });
    resolvers[1]({ success: true, templates: [template("b", "church-2")] });
    await act(async () => { await requestB; });

    expect(result.current.templates.data.map(({ templateId }) => templateId)).toEqual(["new-a"]);
  });

  it("rejects an old A error after an A to B to A switch", async () => {
    const completions: Array<{
      resolve: (value: { success: boolean; templates: ServicePlanTemplate[] }) => void;
      reject: (error: Error) => void;
    }> = [];
    mockListTemplates.mockImplementation(() => new Promise((resolve, reject) => {
      completions.push({ resolve, reject });
    }));
    const { result, rerender } = renderResources();
    let firstA!: Promise<void>;
    act(() => { firstA = result.current.templates.ensureLoaded(); });

    churchId = "church-2";
    rerender();
    let requestB!: Promise<void>;
    act(() => { requestB = result.current.templates.ensureLoaded(); });
    churchId = "church-1";
    rerender();
    let secondA!: Promise<void>;
    act(() => { secondA = result.current.templates.ensureLoaded(); });

    completions[2].resolve({ success: true, templates: [template("new-a")] });
    await act(async () => { await secondA; });
    completions[0].reject(new Error("stale failure"));
    await act(async () => { await firstA; });
    completions[1].resolve({ success: true, templates: [template("b", "church-2")] });
    await act(async () => { await requestB; });

    expect(result.current.templates.data.map(({ templateId }) => templateId)).toEqual(["new-a"]);
    expect(result.current.templates.error).toBeNull();
  });

  it("keeps mutations made during a load when the response arrives", async () => {
    let resolveRequest: ((value: { success: boolean; templates: ServicePlanTemplate[] }) => void) | undefined;
    mockListTemplates.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const { result } = renderResources();
    let request!: Promise<void>;
    act(() => { request = result.current.templates.ensureLoaded(); });
    act(() => {
      result.current.templates.upsert(template("new"));
      result.current.templates.remove("removed");
    });
    resolveRequest?.({ success: true, templates: [template("old"), template("removed")] });
    await act(async () => { await request; });
    expect(result.current.templates.data.map(({ templateId }) => templateId)).toEqual(["old", "new"]);
  });

  it("ignores a template mutation from another church", () => {
    const { result } = renderResources();
    act(() => { result.current.templates.upsert(template("foreign", "church-2")); });
    expect(result.current.templates.data).toEqual([]);
  });
});
