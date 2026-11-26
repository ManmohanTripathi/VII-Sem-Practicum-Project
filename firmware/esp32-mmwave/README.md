# Bathroom fall sensor (optional): ESP32 + HLK-LD2410C mmWave radar

A privacy-safe fall alarm for the bathroom, where a camera is not acceptable. It records no image and
no sound. **It is optional:** until this sensor publishes its first message, the backend, the
dashboard and the app behave exactly as before (no card, no alerts, no offline checks).

## How it works

Only the ESP32 and the radar are needed. The radar is on the ceiling, pointing down, so the distance
to a person is a measure of height. A breathing person who lies without moving still gives "still
energy", so the radar keeps seeing them.

| Rule | What happens |
|---|---|
| Presence for 2 s | `occupied` |
| No presence for `LEAVE_S` (10 s) | `empty`: the person left |
| At floor level (still target farther than `FLOOR_CM`) and not moving for `ON_FLOOR_S` (30 s) | Fall check starts (`checking`) |
| In the bathroom longer than `LONG_STAY_MIN` (30 min) | Long-stay check starts |
| During a check: the person is upright again for 5 s, or leaves | Back to normal, `{"type":"ok"}` |
| Fall check still the same after `CHECK_S` (60 s) | Publishes `fall`, repeated every 60 s while the person stays down |
| Long-stay check still the same after 60 s | Publishes `long_stay` once, then the 30-minute timer starts again |

Each `fall` or `long_stay` is a critical alert with the siren on every caretaker device. The board also
sends `{"type":"status"}` every 30 s, so the dashboard and the caretaker app show a "Bathroom sensor"
card. If the heartbeats stop for 3 minutes, caretakers get one "sensor offline" warning. Without the
radar frames, the board reports `"radar":"missing"` and never alarms.

**Limit:** the radar cannot tell "left the room" from "stopped breathing", because both look like no
presence. With the radar only, no presence for 10 s counts as "left".

## Parts

| Part | Pin |
|---|---|
| HLK-LD2410C (or LD2410B) | VCC 5V, GND, TX → GPIO16, RX → GPIO17 (256000 baud) |
| ESP32 DevKit, 5 V adapter, plastic box | onboard LED on GPIO2 |
| Optional: active buzzer, 5 V | GPIO25 through an NPN transistor; set `BUZZER_PIN = 25` |
| Optional: "I am OK" push button | GPIO26 ↔ GND; set `OK_PIN = 26` |

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
