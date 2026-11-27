"""One frame in, people out: YOLO pose finds each person and their posture, DeepFace says who."""

import logging
from typing import Optional

from . import config
from .faces import face_owner, recognize
from .posture import classify_posture

log = logging.getLogger("vision.pipeline")

_model = None


def pose_model():
    global _model
    if _model is None:
        from ultralytics import YOLO

        _model = YOLO(config.POSE_MODEL)
    return _model


def detect_people(frame_bgr) -> list[dict]:
    """[{"box": (x1, y1, x2, y2), "posture": ..., "confidence": c}] for every person above PERSON_CONF."""
    result = pose_model()(frame_bgr, verbose=False, conf=config.PERSON_CONF)[0]
    people = []
    if result.keypoints is None or result.boxes is None:
        return people
    kps_all = result.keypoints.data.cpu().numpy()  # n x 17 x 3
    for box, conf, kps in zip(result.boxes.xyxy.cpu().numpy(), result.boxes.conf.cpu().numpy(), kps_all):
        box = tuple(float(v) for v in box)
        people.append({"box": box, "posture": classify_posture(kps.tolist(), box), "confidence": float(conf)})
    return people


def analyze(frame_bgr, known_faces: Optional[list] = None, with_faces: bool = True) -> list[dict]:
    people = detect_people(frame_bgr)
    for p in people:
        p["identity"] = None
    if with_faces and people:
        try:
            for face in recognize(frame_bgr, known_faces or []):
                i = face_owner(face["box"], [p["box"] for p in people])
                if i is not None and people[i]["identity"] in (None, "unknown"):
                    people[i]["identity"] = face["identity"]
        except Exception as err:  # face model trouble must never stop fall detection
            log.warning("face recognition failed: %s", err)
    # Biggest person first: closest to the camera, the one the fall rule follows.
    people.sort(key=lambda p: (p["box"][2] - p["box"][0]) * (p["box"][3] - p["box"][1]), reverse=True)
    return people
