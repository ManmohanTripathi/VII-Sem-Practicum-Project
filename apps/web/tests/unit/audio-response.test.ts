import { describe, expect, it } from "vitest";
import { audioResponse } from "@/lib/audio-response";

const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const get = (range?: string) => audioResponse(new Request("http://x/a", { headers: range ? { range } : {} }), data, "audio/mp4", "private");

describe("audioResponse (Range support for Safari)", () => {
  it("returns the whole file without a Range header", async () => {
    const res = get();
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
  });

  it("answers Safari's probe and open-ended ranges with 206", async () => {
    const probe = get("bytes=0-1");
    expect(probe.status).toBe(206);
    expect(probe.headers.get("content-range")).toBe("bytes 0-1/10");
    expect([...new Uint8Array(await probe.arrayBuffer())]).toEqual([0, 1]);
    const rest = get("bytes=7-");
    expect(rest.headers.get("content-range")).toBe("bytes 7-9/10");
    expect([...new Uint8Array(await get("bytes=-3").arrayBuffer())]).toEqual([7, 8, 9]);
  });

  it("rejects ranges past the end with 416", () => {
    const res = get("bytes=20-30");
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });
});
