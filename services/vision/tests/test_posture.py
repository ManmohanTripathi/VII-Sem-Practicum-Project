from vision.faces import face_owner
from vision.posture import classify_posture
from vision.tracker import FallTracker


def kps(points: dict[int, tuple[float, float]]):
    out = [(0.0, 0.0, 0.0)] * 17
    for i, (x, y) in points.items():
        out[i] = (x, y, 0.9)
    return out


# shoulders 5/6, hips 11/12, knees 13/14
STANDING = kps({5: (90, 100), 6: (110, 100), 11: (92, 200), 12: (108, 200), 13: (92, 290), 14: (108, 290)})
SITTING = kps({5: (90, 100), 6: (110, 100), 11: (92, 200), 12: (108, 200), 13: (180, 210), 14: (190, 205)})
LYING = kps({5: (100, 300), 6: (100, 320), 11: (220, 305), 12: (220, 318), 13: (300, 310), 14: (300, 316)})


def test_postures_from_keypoints():
    assert classify_posture(STANDING, (80, 80, 120, 300)) == "standing"
    assert classify_posture(SITTING, (80, 80, 200, 220)) == "sitting"
    assert classify_posture(LYING, (90, 280, 320, 340)) == "lying"


def test_box_shape_when_torso_hidden():
    assert classify_posture(kps({}), (0, 0, 300, 100)) == "lying"
    assert classify_posture(kps({}), (0, 0, 100, 300)) == "unknown"


def test_fall_needs_sudden_drop_and_staying_down():
    t = FallTracker(transition_s=3, confirm_s=10)
    assert not t.update(0, "standing")
    assert not t.update(2, "lying")  # down within 3 s of standing
    assert not t.update(8, None)  # half out of view: timer keeps running
    assert t.update(12, "lying")  # still down after 10 s -> one fall
    assert not t.update(20, "lying")  # reported once
    assert not t.update(25, "standing")  # got up: reset


def test_lying_down_slowly_is_not_a_fall():
    t = FallTracker(transition_s=3, confirm_s=10)
    t.update(0, "standing")
    t.update(1, "sitting")
    assert not t.update(30, "lying")  # sat on the bed for half a minute first
    assert not t.update(60, "lying")


def test_face_belongs_to_the_box_around_it():
    assert face_owner((100, 100, 140, 140), [(0, 0, 50, 50), (80, 60, 200, 400)]) == 1
    assert face_owner((500, 500, 520, 520), [(0, 0, 50, 50)]) is None
