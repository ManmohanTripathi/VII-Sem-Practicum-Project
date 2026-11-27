// CareCircle bathroom fall sensor: ESP32 + HLK-LD2410C mmWave radar on the ceiling. Nothing else
// is needed: no door switch, no camera, no microphone.
//
// The radar looks down, so the distance to the person is a measure of height: a person at floor
// level is far from the sensor. A person who is breathing still gives "still energy", so the radar
// keeps seeing someone who lies without moving. The ESP32 runs the safety loop by itself and only
// tells the backend about real emergencies:
//
//   EMPTY --presence for ENTER_S--> OCCUPIED
//   OCCUPIED --no presence for LEAVE_S--> EMPTY (the person left)
//   OCCUPIED --at floor level and not moving for ON_FLOOR_S--> CHECKING (fall)
//   OCCUPIED --in the room longer than LONG_STAY_MIN--> CHECKING (long stay)
//   CHECKING --the person gets up / leaves (or presses the optional "I am OK" button)--> back to normal
//   CHECKING --still the same after CHECK_S--> alarm published: fall (repeated every CHECK_S while
//            the person stays down) or long_stay (once, then the long-stay timer starts again)
//
// Without the radar frames the board only reports {"radar":"missing"} and never alarms.
//
// Wiring (ESP32 DevKit):
//   LD2410C  VCC -> 5V, GND -> GND, TX -> GPIO16 (RX2), RX -> GPIO17 (TX2)   (UART 256000 baud)
//   Optional: active buzzer -> GPIO25 (through an NPN transistor), "I am OK" button -> GPIO26 and GND.
//   Leave BUZZER_PIN / OK_PIN at -1 if they are not fitted. Status LED: onboard GPIO2.
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
const int BUZZER_PIN = -1;     // optional
const int OK_PIN = -1;         // optional
const int LED_PIN = 2;

// Measure these in the real bathroom (lie on the floor, sit, stand) and adjust.
const int FLOOR_CM = 210;            // still target farther than this from the ceiling = floor level
const int MOVE_MAX_ON_FLOOR = 20;    // moving energy below this = not moving
const unsigned long ENTER_S = 2;
const unsigned long LEAVE_S = 10;
const unsigned long ON_FLOOR_S = 30;
const unsigned long UP_AGAIN_S = 5;  // upright this long during a check = the person is fine
const unsigned long LONG_STAY_MIN = 30;
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
unsigned long seenSince = 0, goneSince = 0, enteredAt = 0, floorSince = 0, uprightSince = 0, checkStartedAt = 0;
const char* checkReason = "";

void setState(State s) {
  if (s == state) return;
  state = s;
  publish("status");
}

void startCheck(const char* reason) {
  checkReason = reason;
  checkStartedAt = millis();
  uprightSince = 0;
  setState(CHECKING);
}

bool okPressed() { return OK_PIN >= 0 && digitalRead(OK_PIN) == LOW; }

void beep(unsigned long now) {
  if (BUZZER_PIN < 0) return;
  // checking: short beeps every second; otherwise quiet
  digitalWrite(BUZZER_PIN, state == CHECKING && (now / 500) % 2 == 0 ? HIGH : LOW);
}

void step() {
  unsigned long now = millis();
  bool here = present();
  if (here) {
    goneSince = 0;
    if (!seenSince) seenSince = now;
  } else {
    seenSince = 0;
    if (!goneSince) goneSince = now;
  }
  bool left = !here && now - goneSince >= LEAVE_S * 1000;

  switch (state) {
    case EMPTY:
      if (here && now - seenSince >= ENTER_S * 1000) {
        enteredAt = now;
        floorSince = 0;
        setState(OCCUPIED);
      }
      break;

    case OCCUPIED:
    case ON_FLOOR:
      if (left) {
        setState(EMPTY);
        break;
      }
      if (atFloorLevel()) {
        if (!floorSince) floorSince = now;
        setState(ON_FLOOR);
        if (now - floorSince >= ON_FLOOR_S * 1000) startCheck("fall");
      } else if (here) {
        floorSince = 0;
        setState(OCCUPIED);
      }
      if (state != CHECKING && now - enteredAt >= LONG_STAY_MIN * 60000UL) startCheck("long_stay");
      break;

    case CHECKING: {
      // The person is fine if they press "I am OK", leave, or (after a fall check) are upright again.
      bool upright = here && !atFloorLevel();
      if (upright) {
        if (!uprightSince) uprightSince = now;
      } else {
        uprightSince = 0;
      }
      bool recovered = strcmp(checkReason, "fall") == 0 && uprightSince && now - uprightSince >= UP_AGAIN_S * 1000;
      if (okPressed() || left || recovered) {
        publish("ok");
        enteredAt = now;  // restart the long-stay timer
        floorSince = 0;
        setState(left ? EMPTY : OCCUPIED);
      } else if (now - checkStartedAt >= CHECK_S * 1000) {
        char extra[40] = "";
        if (strcmp(checkReason, "long_stay") == 0) snprintf(extra, sizeof(extra), ",\"minutes\":%lu", (now - enteredAt) / 60000);
        publish(checkReason, extra);
        if (strcmp(checkReason, "fall") == 0) {
          checkStartedAt = now;  // a fall: repeat the alarm every CHECK_S until the person is up
        } else {
          enteredAt = now;  // a long stay: one alarm, then watch again (next one after another LONG_STAY_MIN)
          setState(OCCUPIED);
        }
      }
      break;
    }
  }
  beep(now);
}

// The LD2410C's basic report frame (its default output) has everything used here, so the radar
// needs no configuration commands.
void setup() {
  Serial.begin(115200);
  radar.begin(256000, SERIAL_8N1, RADAR_RX, RADAR_TX);
  if (OK_PIN >= 0) pinMode(OK_PIN, INPUT_PULLUP);
  if (BUZZER_PIN >= 0) pinMode(BUZZER_PIN, OUTPUT);
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
  else if (BUZZER_PIN >= 0) digitalWrite(BUZZER_PIN, LOW);  // no radar: never alarm, only report "missing"

  if (now - lastStatusAt >= STATUS_EVERY_S * 1000) {  // heartbeat, so the app knows the sensor is alive
    lastStatusAt = now;
    publish("status");
  }
  // LED: steady = connected, slow blink = radar missing, fast blink = checking
  bool on = state == CHECKING ? (now / 150) % 2 : radarConnected() ? mqtt.connected() : (now / 800) % 2;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}
