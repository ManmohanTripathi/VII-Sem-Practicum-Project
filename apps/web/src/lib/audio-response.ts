import { NextResponse } from "next/server";

// Serve audio bytes with HTTP Range support. Safari (macOS and iOS) won't play an <audio> source
// unless the server answers "Range: bytes=…" with 206 Partial Content; it also lets players seek.
export function audioResponse(request: Request, data: Uint8Array, contentType: string, cacheControl: string) {
  const size = data.byteLength;
  const base = { "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": cacheControl };
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!match || (!match[1] && !match[2])) {
    return new NextResponse(data as BodyInit, { headers: { ...base, "Content-Length": String(size) } });
  }
  // "bytes=a-b", "bytes=a-" or a suffix "bytes=-n" (the last n bytes).
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Number(match[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  start = Math.max(0, start);
  return new NextResponse(data.slice(start, end + 1) as BodyInit, {
    status: 206,
    headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}
