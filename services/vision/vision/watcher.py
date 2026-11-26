"""Watches each elder's camera: reads frames, runs the pipeline, reports to the CareCircle backend."""

import logging
import threading
import time

import cv2
import httpx

from . import config
from .pipeline import analyze
from .tracker import FallTracker

log = logging.getLogger("vision.watcher")


def _headers():
    return {"Authorization": f"Bearer {config.VISION_TOKEN}"}


def post_event(body: dict):
    try:
        r = httpx.post(f"{config.BACKEND_URL}/api/vision/event", json=body, headers=_headers(), timeout=10)
        if r.status_code >= 400:
            log.warning("backend refused %s: %s %s", body["type"], r.status_code, r.text[:200])
    except httpx.HTTPError as err:
        log.warning("backend unreachable: %s", err)


def camera_sources() -> dict[str, str]:
    """elderId -> stream URL (or webcam index), from the backend plus CAMERA_SOURCES overrides."""
    sources: dict[str, str] = {}
    try:
        r = httpx.get(f"{config.BACKEND_URL}/api/vision/cameras", headers=_headers(), timeout=10)
        r.raise_for_status()
        sources = {c["elderId"]: c["streamUrl"] for c in r.json()["cameras"]}
    except (httpx.HTTPError, KeyError, ValueError) as err:
        log.warning("couldn't load cameras from the backend: %s", err)
    for pair in filter(None, (p.strip() for p in config.CAMERA_SOURCES.split(","))):
        elder_id, _, source = pair.partition("=")
        if elder_id and source:
            sources[elder_id.strip()] = source.strip()
    return sources


class CameraWatcher(threading.Thread):
    def __init__(self, elder_id: str, source: str, gallery_ref):
        super().__init__(daemon=True, name=f"cam-{elder_id}")
        self.elder_id, self.source, self.gallery_ref = elder_id, source, gallery_ref
        self.stopped = threading.Event()
        self.tracker = FallTracker(config.FALL_TRANSITION_S, config.FALL_CONFIRM_S)
        self.last_people: list[dict] = []
        self.last_sent = (None, 0.0)
        self.last_face_at = 0.0

    def _open(self):
        src = int(self.source) if self.source.isdigit() else self.source
        cap = cv2.VideoCapture(src)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # always the newest frame, not a backlog
        return cap

    def run(self):
        cap, next_at = None, 0.0
        while not self.stopped.is_set():
            if cap is None or not cap.isOpened():
                cap = self._open()
                if not cap.isOpened():
                    log.warning("camera %s not reachable (%s), retrying", self.elder_id, self.source)
                    self.stopped.wait(10)
                    continue
            ok = cap.grab()  # keep draining the stream; decode only when it's time to analyze
            if not ok:
                cap.release()
                cap = None
                continue
            now = time.monotonic()
            if now < next_at:
                continue
            next_at = now + config.ANALYZE_EVERY_S
            ok, frame = cap.retrieve()
            if ok:
                self.step(frame, now)
        if cap is not None:
            cap.release()

    def step(self, frame, now: float):
        with_faces = now - self.last_face_at >= config.FACE_EVERY_S
        people = analyze(frame, self.gallery_ref().get(self.elder_id, []), with_faces=with_faces)
        if with_faces:
            self.last_face_at = now
        elif len(people) == len(self.last_people):
            # Faces run every few seconds; in between, people keep the identity they had.
            for p, prev in zip(people, self.last_people):
                p["identity"] = prev["identity"]
        self.last_people = people

        main = people[0] if people else None
        if self.tracker.update(now, main["posture"] if main else None):
            log.warning("FALL at %s (%s)", self.elder_id, main and main["identity"])
            post_event({"type": "fall", "elderId": self.elder_id, "identity": main and main["identity"], "confidence": main and main["confidence"]})

        summary = [{"posture": p["posture"], "identity": p["identity"], "confidence": round(p["confidence"], 2)} for p in people]
        key = [(p["posture"], p["identity"]) for p in summary]
        if key != self.last_sent[0] or now - self.last_sent[1] >= config.HEARTBEAT_S:
            self.last_sent = (key, now)
            post_event({"type": "observation", "elderId": self.elder_id, "people": summary})


class WatcherManager(threading.Thread):
    """Starts a watcher per camera and follows camera changes made on the dashboard."""

    def __init__(self, gallery_ref):
        super().__init__(daemon=True, name="watchers")
        self.gallery_ref = gallery_ref
        self.watchers: dict[str, CameraWatcher] = {}
        self.stopped = threading.Event()

    def run(self):
        while not self.stopped.is_set():
            wanted = camera_sources()
            for elder_id, w in list(self.watchers.items()):
                if wanted.get(elder_id) != w.source:
                    w.stopped.set()
                    del self.watchers[elder_id]
            for elder_id, source in wanted.items():
                if elder_id not in self.watchers:
                    log.info("watching %s at %s", elder_id, source)
                    self.watchers[elder_id] = CameraWatcher(elder_id, source, self.gallery_ref)
                    self.watchers[elder_id].start()
            self.stopped.wait(60)

    def stop(self):
        self.stopped.set()
        for w in self.watchers.values():
            w.stopped.set()
