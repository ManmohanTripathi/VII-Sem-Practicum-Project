"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Records the microphone as 16 kHz mono WAV: plays everywhere, including iPhones (which can't play
// the WebM/Opus that MediaRecorder produces in Chrome). Needs a secure context (https or localhost).

const TARGET_RATE = 16000;
const MAX_SECONDS = 120;

function encodeWav(samples: Float32Array, rate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([buffer], { type: "audio/wav" });
}

function downsample(input: Float32Array, from: number, to: number) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export function useWavRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const parts = useRef<Float32Array[]>([]);
  const cleanup = useRef<() => void>(() => {});
  const rate = useRef(48000);
  const done = useRef<((b: Blob) => void) | null>(null);

  // Decided after mounting: the server can't know, and guessing differently there breaks hydration.
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser capability check
    setSupported(window.isSecureContext && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const stop = useCallback(() => {
    return new Promise<Blob>((resolve) => {
      done.current = resolve;
      cleanup.current();
    });
  }, []);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const ctx = new AudioContext();
    rate.current = ctx.sampleRate;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    parts.current = [];
    processor.onaudioprocess = (e) => parts.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(processor);
    processor.connect(ctx.destination);
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) cleanup.current();
    }, 250);
    cleanup.current = () => {
      clearInterval(tick);
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      setRecording(false);
      const total = parts.current.reduce((n, p) => n + p.length, 0);
      const all = new Float32Array(total);
      let off = 0;
      for (const p of parts.current) {
        all.set(p, off);
        off += p.length;
      }
      const blob = encodeWav(downsample(all, rate.current, TARGET_RATE), TARGET_RATE);
      done.current?.(blob);
      done.current = null;
      cleanup.current = () => {};
    };
    setSeconds(0);
    setRecording(true);
  }, []);

  return { supported, recording, seconds, start, stop };
}
