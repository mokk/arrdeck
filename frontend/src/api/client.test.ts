import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./client";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const ok = (body: unknown, status = 200) =>
  ({ ok: true, status, json: async () => body }) as unknown as Response;
const fail = (status: number, body: unknown) =>
  ({
    ok: false,
    status,
    json: async () => {
      if (body === undefined) throw new Error("not json");
      return body;
    },
  }) as unknown as Response;

describe("request paths", () => {
  it("prefixes every call with the api root", async () => {
    fetchMock.mockResolvedValue(ok({ hi: true }));
    await api.get("/services");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/services");
  });

  it("returns undefined for 204 instead of trying to parse a body", async () => {
    // json() would throw on an empty body; mutations rely on this
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error("no body");
      },
    } as unknown as Response);
    await expect(api.post("/push/subscribe", { a: 1 })).resolves.toBeUndefined();
  });
});

describe("request bodies", () => {
  it("sets the json content type for a serialised body", async () => {
    fetchMock.mockResolvedValue(ok({}));
    await api.post("/x", { a: 1 });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("leaves FormData alone so the browser can set its own boundary", async () => {
    fetchMock.mockResolvedValue(ok({}));
    await api.postForm("/torrents/qbittorrent/add-file", new FormData());
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
  });

  it("omits the body entirely when there is nothing to send", async () => {
    fetchMock.mockResolvedValue(ok({}));
    await api.post("/push/test");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });
});

describe("error surfacing", () => {
  // every failed mutation becomes a toast, so the message the wrapper picks
  // is what the user actually reads
  it("prefers the structured service_unavailable message", async () => {
    fetchMock.mockResolvedValue(
      fail(502, { error: { code: "service_unavailable", message: "radarr: unreachable" } }),
    );
    await expect(api.get("/queue")).rejects.toThrow("radarr: unreachable");
  });

  it("falls back to FastAPI's detail", async () => {
    fetchMock.mockResolvedValue(fail(422, { detail: "episodes need a series_id" }));
    await expect(api.post("/x")).rejects.toThrow("episodes need a series_id");
  });

  it("falls back to the status code when the body isn't json", async () => {
    fetchMock.mockResolvedValue(fail(500, undefined));
    await expect(api.get("/x")).rejects.toThrow("HTTP 500");
  });

  it("carries the status on the error so callers can branch on 401", async () => {
    fetchMock.mockResolvedValue(fail(401, { detail: "unauthorized" }));
    await api.get("/services").catch((error) => {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
    });
    expect.assertions(2);
  });
});
