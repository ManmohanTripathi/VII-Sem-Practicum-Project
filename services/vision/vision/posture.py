"""Posture from YOLO pose keypoints (COCO-17 order).

Rule-based on purpose: it needs no training data, every decision can be explained, and it only
uses angles, so it works at any distance from the camera.
"""

import math
from typing import Optional, Sequence

NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE = 0, 5, 6, 11, 12, 13, 14

KP_MIN_CONF = 0.3
LYING_TORSO_DEG = 60  # torso more than this from vertical
SITTING_THIGH_DEG = 50  # thigh more than this from vertical (and torso upright)
LYING_BOX_RATIO = 1.3  # box width / height, fallback when the torso is not visible

Point = Optional[tuple[float, float]]


def _pt(kps: Sequence[Sequence[float]], i: int) -> Point:
    x, y, c = kps[i]
    return (x, y) if c >= KP_MIN_CONF else None


def _mid(a: Point, b: Point) -> Point:
    if a and b:
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return a or b


def angle_from_vertical(top: tuple[float, float], bottom: tuple[float, float]) -> float:
    dx, dy = bottom[0] - top[0], bottom[1] - top[1]
    return math.degrees(math.atan2(abs(dx), abs(dy)))


def classify_posture(kps: Sequence[Sequence[float]], box: Sequence[float]) -> str:
    """kps: 17 x (x, y, conf) in pixels; box: (x1, y1, x2, y2). Returns standing|sitting|lying|unknown."""
    shoulder = _mid(_pt(kps, L_SHOULDER), _pt(kps, R_SHOULDER))
    hip = _mid(_pt(kps, L_HIP), _pt(kps, R_HIP))
    knee = _mid(_pt(kps, L_KNEE), _pt(kps, R_KNEE))
    w, h = box[2] - box[0], box[3] - box[1]

    if shoulder and hip:
        if angle_from_vertical(shoulder, hip) > LYING_TORSO_DEG:
            return "lying"
        if knee:
            return "sitting" if angle_from_vertical(hip, knee) > SITTING_THIGH_DEG else "standing"
        # Legs hidden (desk, bed edge): a short box for an upright torso means sitting.
        return "sitting" if h > 0 and w / h > 0.75 else "standing"

    if h > 0 and w / h > LYING_BOX_RATIO:
        return "lying"
    return "unknown"
