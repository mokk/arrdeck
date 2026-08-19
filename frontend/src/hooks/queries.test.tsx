import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  postForm: vi.fn(),
}));
vi.mock("../api/client", () => ({ api }));

import { useDiskSpace, usePushEvents, useSavePushEvents } from "./queries";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("usePushEvents", () => {
  it("url-encodes the push endpoint", async () => {
    api.get.mockResolvedValue({ available: [], enabled: [], device: null });
    const endpoint = "https://web.push.apple.com/AB?x=1&y=2";
    renderHook(() => usePushEvents(true, endpoint), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    // a raw endpoint would break the query string at its own ? and &
    expect(api.get).toHaveBeenCalledWith(
      `/push/events?endpoint=${encodeURIComponent(endpoint)}`,
    );
  });

  it("caches per endpoint, so two devices don't share a preference set", async () => {
    api.get.mockResolvedValue({ available: [], enabled: [], device: null });
    const { result } = renderHook(() => usePushEvents(true, "a"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    renderHook(() => usePushEvents(true, "b"), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
});

describe("useSavePushEvents", () => {
  it("passes the endpoint through so the choice lands on one device", async () => {
    api.put.mockResolvedValue({ available: [], enabled: [], device: ["grabbed"] });
    const { result } = renderHook(() => useSavePushEvents(), { wrapper });
    result.current.mutate({ enabled: ["grabbed"], endpoint: "https://push/1" });
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith("/push/events", {
      enabled: ["grabbed"],
      endpoint: "https://push/1",
    });
  });
});

describe("useDiskSpace", () => {
  it("stays quiet until the arrs are known to be configured", () => {
    renderHook(() => useDiskSpace(false), { wrapper });
    expect(api.get).not.toHaveBeenCalled();
  });
});
