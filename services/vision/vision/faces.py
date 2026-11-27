"""Face recognition with DeepFace: who is in view, compared with the enrolled photos in faces/."""

import logging
import os
from typing import Optional

import numpy as np

from . import config

log = logging.getLogger("vision.faces")

# elderId -> list of (label, unit embedding)
Gallery = dict[str, list[tuple[str, np.ndarray]]]


def _unit(v) -> np.ndarray:
    a = np.asarray(v, dtype=np.float32)
    return a / (np.linalg.norm(a) + 1e-9)


def _represent(img):
    from deepface import DeepFace  # heavy import (TensorFlow): only when faces are actually used

    return DeepFace.represent(
        img_path=img,
        model_name=config.FACE_MODEL,
        detector_backend=config.FACE_DETECTOR,
        enforce_detection=False,
        align=True,
    )


def load_gallery(root: str = config.FACES_DIR) -> Gallery:
    gallery: Gallery = {}
    if not os.path.isdir(root):
        return gallery
    for elder_id in sorted(os.listdir(root)):
        elder_dir = os.path.join(root, elder_id)
        if not os.path.isdir(elder_dir):
            continue
        for label in sorted(os.listdir(elder_dir)):
            person_dir = os.path.join(elder_dir, label)
            if not os.path.isdir(person_dir):
                continue
            for name in sorted(os.listdir(person_dir)):
                if not name.lower().endswith((".jpg", ".jpeg", ".png")):
                    continue
                faces = _represent(os.path.join(person_dir, name))
                # An enrolment photo should show one clear face; take the most confident one.
                best = max(faces, key=lambda f: f.get("face_confidence", 0), default=None)
                if best and best.get("face_confidence", 0) > 0:
                    gallery.setdefault(elder_id, []).append((label, _unit(best["embedding"])))
                else:
                    log.warning("no face found in %s", os.path.join(person_dir, name))
    log.info("face gallery: %s", {k: len(v) for k, v in gallery.items()})
    return gallery


def match(embedding: np.ndarray, known: list[tuple[str, np.ndarray]]) -> tuple[str, float]:
    """Nearest enrolled face by cosine distance. Returns (label or "unknown", distance)."""
    best_label, best_dist = "unknown", 2.0
    for label, ref in known:
        dist = 1.0 - float(np.dot(embedding, ref))
        if dist < best_dist:
            best_label, best_dist = label, dist
    return (best_label if best_dist <= config.FACE_MAX_DISTANCE else "unknown"), best_dist


def recognize(frame_bgr, known: list[tuple[str, np.ndarray]]) -> list[dict]:
    """All faces in the frame: [{"box": (x1, y1, x2, y2), "identity": label|"unknown", "distance": d}]."""
    out = []
    for f in _represent(frame_bgr):
        if f.get("face_confidence", 0) <= 0:  # enforce_detection=False returns the whole frame when no face
            continue
        a = f["facial_area"]
        identity, dist = match(_unit(f["embedding"]), known) if known else ("unknown", 2.0)
        out.append({"box": (a["x"], a["y"], a["x"] + a["w"], a["y"] + a["h"]), "identity": identity, "distance": dist})
    return out


def face_owner(face_box, person_boxes) -> Optional[int]:
    """Index of the person box that contains the centre of this face."""
    cx, cy = (face_box[0] + face_box[2]) / 2, (face_box[1] + face_box[3]) / 2
    for i, (x1, y1, x2, y2) in enumerate(person_boxes):
        if x1 <= cx <= x2 and y1 <= cy <= y2:
            return i
    return None
