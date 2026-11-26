import os

# All settings come from the environment, so the same code runs on a laptop or a small server.
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000").rstrip("/")
VISION_TOKEN = os.getenv("VISION_TOKEN", "")

# Extra or override cameras: "elderId=source,elderId=source". A source is a stream URL or a webcam
# index ("0" = the laptop camera, handy for a demo without the ESP32-CAM).
CAMERA_SOURCES = os.getenv("CAMERA_SOURCES", "")

# How frames are read from the ESP32-CAM. "/stream" keeps its MJPEG stream open. Many ESP32-CAM
# sketches serve only one stream viewer at a time, so if the dashboard's live feed stops while this
# service runs, set a snapshot path the firmware has (e.g. "/capture" or "/cam-hi.jpg"): the service
# then fetches one JPEG per analysis and leaves the stream free for the family.
CAMERA_PATH = os.getenv("CAMERA_PATH", "/stream")

POSE_MODEL = os.getenv("POSE_MODEL", "yolo11n-pose.pt")  # downloaded by Ultralytics on first run
PERSON_CONF = float(os.getenv("PERSON_CONF", "0.5"))
FACE_MODEL = os.getenv("FACE_MODEL", "Facenet512")
FACE_DETECTOR = os.getenv("FACE_DETECTOR", "opencv")
FACE_MAX_DISTANCE = float(os.getenv("FACE_MAX_DISTANCE", "0.30"))  # cosine distance; DeepFace's threshold for Facenet512
FACES_DIR = os.getenv("FACES_DIR", os.path.join(os.path.dirname(__file__), "..", "faces"))

ANALYZE_EVERY_S = float(os.getenv("ANALYZE_EVERY_S", "1.0"))
FACE_EVERY_S = float(os.getenv("FACE_EVERY_S", "5.0"))
HEARTBEAT_S = float(os.getenv("HEARTBEAT_S", "60"))

# Fall rule: upright (standing/sitting) and then lying within FALL_TRANSITION_S, still lying after FALL_CONFIRM_S.
FALL_TRANSITION_S = float(os.getenv("FALL_TRANSITION_S", "3"))
FALL_CONFIRM_S = float(os.getenv("FALL_CONFIRM_S", "10"))
