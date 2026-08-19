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

import {
  useDiskSpace,
  usePushEvents,
  useSavePushEvents,
  useSetSpeedLimit,
  useSubtitleSearch,
} from "./queries";

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

describe("useSetSpeedLimit", () => {
  it("calls every client, because they don't share a throttle", async () => {
    api.post.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSetSpeedLimit(), { wrapper });
    result.current.mutate({ clients: ["qbittorrent", "transmission"], enabled: true });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenCalledWith("/torrents/qbittorrent/speed-limit", { enabled: true });
    expect(api.post).toHaveBeenCalledWith("/torrents/transmission/speed-limit", { enabled: true });
  });

  it("does nothing when no client is configured", async () => {
    const { result } = renderHook(() => useSetSpeedLimit(), { wrapper });
    result.current.mutate({ clients: [], enabled: true });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("useSubtitleSearch", () => {
  it("sends the series id for an episode, which bazarr needs alongside the episode id", async () => {
    api.post.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSubtitleSearch(), { wrapper });
    result.current.mutate({ kind: "episode", id: 4296, series_id: 57 });
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith("/subtitles/search", {
      kind: "episode",
      id: 4296,
      series_id: 57,
    });
  });
});
