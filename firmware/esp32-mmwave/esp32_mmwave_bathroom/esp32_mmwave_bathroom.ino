// CareCircle bathroom fall sensor: ESP32 + HLK-LD2410C mmWave radar on the ceiling.
//
// No camera, no microphone. The radar looks down, so the distance to the person is a measure of
// height: a person at floor level is far from the sensor. The ESP32 runs the whole safety loop by
// itself and only tells the backend about real emergencies:
//
//   EMPTY --door opens + presence--> OCCUPIED
//   OCCUPIED --at floor level, still, ON_FLOOR_S--> CHECKING (buzzer beeps)
//   OCCUPIED --in the room longer than LONG_STAY_MIN--> CHECKING
//   OCCUPIED --presence lost, door still closed, LOST_S--> CHECKING
//   CHECKING --"I am OK" pressed--> OCCUPIED (or EMPTY)
//   CHECKING --no press in CHECK_S--> alarm published (fall | long_stay | presence_lost)
//
// Everything is optional: without the radar the board only reports {"radar":"missing"}; without a
// door switch (DOOR_PIN = -1) entry is detected from presence alone.
//
// Wiring (ESP32 DevKit):
//   LD2410C  VCC -> 5V, GND -> GND, TX -> GPIO16 (RX2), RX -> GPIO17 (TX2)   (UART 256000 baud)
//   Door reed switch  -> GPIO27 and GND  (closed = door shut)
//   "I am OK" button  -> GPIO26 and GND
//   Active buzzer     -> GPIO25 (through an NPN transistor), status LED -> GPIO2 (onboard)
//
// Libraries: PubSubClient (Nick O'Leary). Board: "ESP32 Dev Module".

#include <WiFi.h>
#include <PubSubClient.h>

// ---------- settings ----------
const char* WIFI_SSID     = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";
const char* MQTT_HOST     = "broker.hivemq.com";   // same broker as the backend's MQTT_URL
const uint16_t MQTT_PORT  = 1883;
const char* MQTT_TOPIC    = "project/phase3sem7/mmwave";  // backend: MQTT_MMWAVE_TOPIC
const char* ELDER_ID      = "";        // the parent's id from the dashboard URL; "" = backend default
const char* SENSOR_ID     = "bathroom-1";
const char* ROOM          = "bathroom";

const int RADAR_RX = 16, RADAR_TX = 17;
const int DOOR_PIN = 27;       // -1 if there is no door switch
const int OK_PIN = 26;
const int BUZZER_PIN = 25;
const int LED_PIN = 2;

// Measure these in the real bathroom (lie on the floor, sit, stand) and adjust.
const int FLOOR_CM = 210;            // still target farther than this from the ceiling = floor level
const int MOVE_MAX_ON_FLOOR = 20;    // moving energy below this = not moving
const unsigned long ON_FLOOR_S = 30;
const unsigned long LONG_STAY_MIN = 30;
const unsigned long LOST_S = 20;
const unsigned long CHECK_S = 60;
const unsigned long STATUS_EVERY_S = 30;

// ---------- radar ----------
HardwareSerial radar(2);

struct Reading {
  uint8_t target = 0;  // 0 none, 1 moving, 2 still, 3 both
  uint16_t moveCm = 0, stillCm = 0;
  uint8_t moveEnergy = 0, stillEnergy = 0;
};
Reading reading;
unsigned long lastFrameAt = 0;

// Report frame: F4 F3 F2 F1 | len(2, LE) | type(0x01 eng / 0x02 basic) 0xAA | target state |
// move dist(2) | move energy | still dist(2) | still energy | detect dist(2) | ... | 0x55 0x00 | F8 F7 F6 F5
uint8_t buf[64];
size_t bufLen = 0;

void parseFrame(const uint8_t* d, size_t n) {
  if (n < 13 || d[1] != 0xAA) return;
  reading.target = d[2];
  reading.moveCm = d[3] | (d[4] << 8);
  reading.moveEnergy = d[5];
  reading.stillCm = d[6] | (d[7] << 8);
  reading.stillEnergy = d[8];
  lastFrameAt = millis();
}

void readRadar() {
  while (radar.available()) {
    uint8_t b = radar.read();
    if (bufLen < sizeof(buf)) buf[bufLen++] = b;
    else bufLen = 0;
    // resync on the header
    if (bufLen >= 4 && !(buf[0] == 0xF4 && buf[1] == 0xF3 && buf[2] == 0xF2 && buf[3] == 0xF1)) {
      memmove(buf, buf + 1, --bufLen);
      continue;
    }
    if (bufLen >= 6) {
      size_t len = buf[4] | (buf[5] << 8);
      if (len > sizeof(buf) - 10) { bufLen = 0; continue; }
      if (bufLen == len + 10) {
        if (buf[bufLen - 4] == 0xF8 && buf[bufLen - 1] == 0xF5) parseFrame(buf + 6, len);
        bufLen = 0;
      }
    }
  }
}

bool radarConnected() { return lastFrameAt && millis() - lastFrameAt < 5000; }
bool present() { return radarConnected() && reading.target != 0; }
bool atFloorLevel() {
  return present() && (reading.target & 2) && reading.stillCm >= FLOOR_CM && reading.moveEnergy < MOVE_MAX_ON_FLOOR;
}
bool doorClosed() { return DOOR_PIN < 0 || digitalRead(DOOR_PIN) == LOW; }

// ---------- network ----------
WiFiClient net;
PubSubClient mqtt(net);

const char* STATE_NAMES[] = {"empty", "occupied", "on_floor", "checking"};
enum State { EMPTY, OCCUPIED, ON_FLOOR, CHECKING };
State state = EMPTY;

void publish(const char* type, const char* extra = "") {
  if (!mqtt.connected()) return;
  char msg[320];
  snprintf(msg, sizeof(msg),
           "{\"type\":\"%s\",\"sensorId\":\"%s\",\"room\":\"%s\",\"state\":\"%s\",\"radar\":\"%s\","
           "\"distanceCm\":%u,\"moveEnergy\":%u,\"stillEnergy\":%u%s%s%s%s}",
           type, SENSOR_ID, ROOM, STATE_NAMES[state], radarConnected() ? "ok" : "missing",
           reading.target ? reading.stillCm : 0, reading.moveEnergy, reading.stillEnergy,
           strlen(ELDER_ID) ? ",\"elderId\":\"" : "", ELDER_ID, strlen(ELDER_ID) ? "\"" : "", extra);
  mqtt.publish(MQTT_TOPIC, msg);
}

void keepConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  }
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()) {
    String id = String("carecircle-mmwave-") + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(id.c_str())) publish("status");
  }
}

// ---------- state machine ----------
unsigned long enteredAt = 0, floorSince = 0, lostSince = 0, checkStartedAt = 0, doorOpenedAt = 0;
const char* checkReason = "";
bool doorWasClosed = true;

void setState(State s) {
  if (s == state) return;
  state = s;
  publish("status");
}

void startCheck(const char* reason) {
  checkReason = reason;
  checkStartedAt = millis();
  setState(CHECKING);
}

void beep(unsigned long now) {
  // checking: short beeps every second; otherwise quiet
  digitalWrite(BUZZER_PIN, state == CHECKING && (now / 500) % 2 == 0 ? HIGH : LOW);
}

void step() {
  unsigned long now = millis();
  bool closed = doorClosed();
  if (doorWasClosed && !closed) doorOpenedAt = now;
  doorWasClosed = closed;
  // The person can leave through an open door, or the radar can lose them a little after the door
  // opened: both mean "left", not "lost".
  bool leftRoom = DOOR_PIN < 0 || !closed || (doorOpenedAt && now - doorOpenedAt < 60000UL);

  switch (state) {
    case EMPTY:
      if (present()) {
        enteredAt = now;
        floorSince = lostSince = 0;
        setState(OCCUPIED);
      }
      break;

    case OCCUPIED:
    case ON_FLOOR:
      if (!present()) {
        if (leftRoom) {
          setState(EMPTY);
          break;
        }
        if (!lostSince) lostSince = now;
        if (now - lostSince >= LOST_S * 1000) startCheck("presence_lost");
        break;
      }
      lostSince = 0;
      if (atFloorLevel()) {
        if (!floorSince) floorSince = now;
        setState(ON_FLOOR);
        if (now - floorSince >= ON_FLOOR_S * 1000) startCheck("fall");
      } else {
        floorSince = 0;
        setState(OCCUPIED);
      }
      if (state != CHECKING && now - enteredAt >= LONG_STAY_MIN * 60000UL) startCheck("long_stay");
      break;

    case CHECKING:
      if (digitalRead(OK_PIN) == LOW) {  // "I am OK"
        publish("ok");
        enteredAt = now;  // restart the long-stay timer
        floorSince = lostSince = 0;
        setState(present() ? OCCUPIED : EMPTY);
      } else if (now - checkStartedAt >= CHECK_S * 1000) {
        char extra[40] = "";
        if (strcmp(checkReason, "long_stay") == 0) snprintf(extra, sizeof(extra), ",\"minutes\":%lu", (now - enteredAt) / 60000);
        publish(checkReason, extra);
        checkStartedAt = now;  // keep beeping; repeat the alarm every CHECK_S until someone comes
      }
      break;
  }
  beep(now);
}

// The LD2410C's basic report frame (its default output) has everything used here, so the radar
// needs no configuration commands.
void setup() {
  Serial.begin(115200);
  radar.begin(256000, SERIAL_8N1, RADAR_RX, RADAR_TX);
  if (DOOR_PIN >= 0) pinMode(DOOR_PIN, INPUT_PULLUP);
  pinMode(OK_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  WiFi.mode(WIFI_STA);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  keepConnected();
}

unsigned long lastStatusAt = 0, lastNetCheckAt = 0;

void loop() {
  readRadar();
  unsigned long now = millis();
  if (now - lastNetCheckAt > 5000) {
    lastNetCheckAt = now;
    keepConnected();
  }
  mqtt.loop();

  if (radarConnected()) step();
  else digitalWrite(BUZZER_PIN, LOW);  // no radar: never alarm, only report "missing"

  if (now - lastStatusAt >= STATUS_EVERY_S * 1000) {  // heartbeat, so the app knows the sensor is alive
    lastStatusAt = now;
    publish("status");
  }
  // LED: steady = connected, slow blink = radar missing, fast blink = checking
  bool on = state == CHECKING ? (now / 150) % 2 : radarConnected() ? mqtt.connected() : (now / 800) % 2;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}
