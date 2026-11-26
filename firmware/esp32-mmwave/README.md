# Bathroom fall sensor (optional): ESP32 + HLK-LD2410C mmWave radar

A privacy-safe fall alarm for the bathroom, where a camera is not acceptable. It records no image and
no sound. **It is optional:** until this sensor publishes its first message, the backend, the
dashboard and the app behave exactly as before (no card, no alerts, no offline checks).

## How it works

The radar is on the ceiling, pointing down, so the distance to a person is a measure of height.

| Rule | What happens |
|---|---|
| Person at floor level (still target farther than `FLOOR_CM`), not moving, for `ON_FLOOR_S` (30 s) | Buzzer beeps |
| Person in the bathroom longer than `LONG_STAY_MIN` (30 min) | Buzzer beeps |
| Radar loses the person, door still closed, for `LOST_S` (20 s) | Buzzer beeps |
| "I am OK" pressed within `CHECK_S` (60 s) | Back to normal, `{"type":"ok"}` |
| No press | Publishes `fall`, `long_stay` or `presence_lost`: critical alert with the siren on every caretaker device, repeated every 60 s |

The board also sends `{"type":"status"}` every 30 s. The dashboard and the caretaker app then show a
"Bathroom sensor" card. If the heartbeats stop for 3 minutes, caretakers get one "sensor offline"
warning. Without the radar wired, the board reports `"radar":"missing"` and never alarms.

## Parts (approximate prices, not verified)

| Part | Pin |
|---|---|
| HLK-LD2410C (or LD2410B) | VCC 5V, GND, TX → GPIO16, RX → GPIO17 (256000 baud) |
| Door reed switch + magnet | GPIO27 ↔ GND (closed = door shut). Set `DOOR_PIN = -1` if you have none |
| Push button "I am OK" | GPIO26 ↔ GND |
| Active buzzer, 5 V | GPIO25 through an NPN transistor |
| ESP32 DevKit, 5 V adapter, plastic box | onboard LED on GPIO2 |

## Flashing

1. Arduino IDE → Boards Manager → **esp32 by Espressif Systems**. Library Manager → **PubSubClient**.
2. Set `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_HOST` (the same broker as the backend's `MQTT_URL`) and `ELDER_ID` (the parent's id from the dashboard URL; empty = the backend's `MQTT_ALERT_ELDER_ID`).
3. Board **ESP32 Dev Module**, upload, open Serial Monitor at 115200.

## Calibrating (do this once, in the real bathroom)

Stand, sit, and lie on a mat on the floor under the sensor and at the walls, and watch `distanceCm`
in the status messages (`mosquitto_sub -h broker.hivemq.com -t project/phase3sem7/mmwave`). Set
`FLOOR_CM` between the "sitting" and "lying" values. Check the shower too: falling water can look like
movement.

## Safety

- **WARNING:** keep the 5 V adapter and all mains wiring outside the wet zone.
- Use a plastic box: metal blocks the radar.
- This is not a certified medical or emergency device.
