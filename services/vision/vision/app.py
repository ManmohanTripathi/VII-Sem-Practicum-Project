"""CareCircle camera AI: fall detection (YOLO pose) and face recognition (DeepFace).

Run:  uvicorn vision.app:app --port 8100
"""

import logging
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile

from . import config
from .faces import load_gallery
from .pipeline import analyze, pose_model
from .watcher import WatcherManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("vision")

state = {"gallery": {}}


def gallery():
    return state["gallery"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    pose_model()  # load (and on first run download) the model before frames arrive
    state["gallery"] = load_gallery()
    manager = None
    if config.VISION_TOKEN:
        manager = WatcherManager(gallery)
        manager.start()
    else:
        log.warning("VISION_TOKEN is empty: cameras are not watched, only /analyze works")
    yield
    if manager:
        manager.stop()


app = FastAPI(title="CareCircle vision", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True, "enrolled": {k: sorted({label for label, _ in v}) for k, v in gallery().items()}}


@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...), elder_id: str | None = None):
    """Try the models on one photo: people, posture and (with elder_id) who they are."""
    frame = cv2.imdecode(np.frombuffer(await file.read(), np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "not an image")
    people = analyze(frame, gallery().get(elder_id or "", []))
    return {"people": [{**p, "box": [round(v) for v in p["box"]]} for p in people]}


@app.post("/faces/reload")
def reload_faces():
    state["gallery"] = load_gallery()
    return health()
