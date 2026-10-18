// SweatSalt device firmware — Seeed XIAO ESP32-C3
//
// Single-file firmware for the SweatSalt companion PWA (sweatsalt-app).
// Sensors: TMP117 (skin temp), MPU-6050 (accel), analog GSR, analog pulse
// sensor, battery divider. Extras: SSD1306 OLED status, vibration motor.
//
// Needs: arduino-esp32 core 3.x, NimBLE-Arduino 2.x, Adafruit GFX +
// Adafruit SSD1306. TMP117 and MPU-6050 are read over raw I2C, so no
// extra sensor libraries.
// Tools -> "USB CDC On Boot: Enabled" to see Serial output on the C3.

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <NimBLEDevice.h>

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

// Pin map. All three analog inputs are on ADC1 (GPIO2-4), which keeps them
// clear of ADC2/radio contention. Update the schematic to match.
#define PIN_BATTERY_ADC  D0   // GPIO2, 220k/220k divider midpoint
#define PIN_GSR_ADC      D1   // GPIO3
#define PIN_PULSE_ADC    D2   // GPIO4
#define PIN_VIBRATION    D3   // GPIO5, PWM
#define PIN_I2C_SDA      D4   // GPIO6
#define PIN_I2C_SCL      D5   // GPIO7
#define PIN_STATUS_LED   D10  // GPIO10, active-low (as in battery_tested)

// I2C devices
#define TMP117_ADDR      0x48
#define MPU_ADDR         0x68
#define OLED_ADDR        0x3D
#define OLED_WIDTH       128
#define OLED_HEIGHT      64

// BLE identity. Model -> app "name", serial -> app "id" (Device Info 0x180A).
#define BLE_DEVICE_NAME    "SweatSalt"
#define BLE_MANUFACTURER   "SweatSalt Project"
#define BLE_MODEL_NUMBER   "SS-MVP-1"

// GATT layout. Must stay byte-for-byte identical to the app's
// src/datasource/bleDataSource.ts. Sensor characteristics are NOTIFY,
// 4-byte float32 little-endian. Units: gsr = microsiemens, hr = bpm,
// temp = degC, imu = accel magnitude in g.
#define SWEATSALT_SERVICE_UUID "5a7b0000-0001-4a6e-9c1a-000000000000"
#define CHAR_GSR_UUID          "5a7b0000-0001-4a6e-9c1a-000000000001"
#define CHAR_HR_UUID           "5a7b0000-0001-4a6e-9c1a-000000000002"
#define CHAR_TEMP_UUID         "5a7b0000-0001-4a6e-9c1a-000000000003"
#define CHAR_IMU_UUID          "5a7b0000-0001-4a6e-9c1a-000000000004"
// Not used by the app yet: write one byte 0-255 to set vibration motor PWM.
#define CHAR_VIBRATION_UUID    "5a7b0000-0001-4a6e-9c1a-000000000005"

// Notify / sample periods
#define PULSE_SAMPLE_MS    10     // 100 Hz for beat detection
#define IMU_PERIOD_MS      200    // 5 Hz
#define SLOW_PERIOD_MS     1000   // gsr, hr, temp
#define BATTERY_PERIOD_MS  10000
#define OLED_PERIOD_MS     500

// Battery (LiPo through a 1:2 divider)
#define BATT_DIVIDER_RATIO 2.0f
#define BATT_EMPTY_V       3.3f
#define BATT_FULL_V        4.2f

#define BPM_MIN_VALID      40
#define BPM_MAX_VALID      200

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
bool oledOk = false;
bool tempOk = false;
bool imuOk = false;

NimBLEServer *bleServer;
NimBLECharacteristic *gsrChar, *hrChar, *tempChar, *imuChar, *batteryChar;

float lastTempC = NAN;
float lastGsrUs = NAN;
float lastHrBpm = NAN;  // NAN until a valid beat rate has been measured
float lastAccelG = NAN;
uint8_t lastBatteryPct = 0;

// ---------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------

bool i2cPresent(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

// TMP117: register 0x00, signed 16-bit, 0.0078125 degC/LSB. Powers up in
// continuous conversion, so just read it.
bool readTmp117(float &outC) {
  Wire.beginTransmission(TMP117_ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)TMP117_ADDR, (uint8_t)2) != 2) return false;
  int16_t raw = (Wire.read() << 8) | Wire.read();
  outC = raw * 0.0078125f;
  return true;
}

void initMpu() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);  // PWR_MGMT_1: clear sleep bit
  Wire.write(0);
  imuOk = Wire.endTransmission(true) == 0;
}

// Accel magnitude in g at the default +-2g range (16384 LSB/g).
bool readAccelG(float &outG) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)6) != 6) return false;
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  float x = ax / 16384.0f, y = ay / 16384.0f, z = az / 16384.0f;
  outG = sqrtf(x * x + y * y + z * z);
  return true;
}

// GSR in microsiemens. Uses the Grove GSR divider formula scaled to a
// 12-bit ADC; ratio-based so it doesn't depend on supply voltage. This is
// an uncalibrated estimate — trend is meaningful, absolute value is not
// until calibrated against known resistors.
float readGsrMicrosiemens() {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(PIN_GSR_ADC);
  float raw = sum / 16.0f;
  float denom = 2048.0f - raw;
  if (denom <= 1.0f) return 0.0f;  // open circuit: electrodes not on skin
  float ohms = ((4096.0f + 2.0f * raw) * 10000.0f) / denom;
  return 1000000.0f / ohms;
}

float readBatteryVolts() {
  uint32_t sumMv = 0;
  for (int i = 0; i < 16; i++) sumMv += analogReadMilliVolts(PIN_BATTERY_ADC);
  return (sumMv / 16.0f) * BATT_DIVIDER_RATIO / 1000.0f;
}

uint8_t batteryPercent(float volts) {
  float pct = (volts - BATT_EMPTY_V) / (BATT_FULL_V - BATT_EMPTY_V) * 100.0f;
  return (uint8_t)constrain(pct, 0.0f, 100.0f);
}

// Pulse sensor beat detector (adaptive midpoint threshold, in the style of
// the PulseSensor Amped algorithm). Call at PULSE_SAMPLE_MS intervals.
// Updates lastHrBpm when a plausible beat interval is seen, and clears it
// to NAN when the signal goes quiet (finger off).
void pulseSample() {
  static int thresh = 2048, peak = 2048, trough = 2048;
  static bool inBeat = false;
  static uint32_t lastBeatMs = 0;
  static uint32_t ibi = 600;
  static uint32_t ibiHist[6];
  static uint8_t ibiCount = 0, ibiPos = 0;

  uint32_t now = millis();
  int sig = analogRead(PIN_PULSE_ADC);
  uint32_t sinceBeat = now - lastBeatMs;

  if (sig < thresh && sinceBeat > (ibi / 5) * 3 && sig < trough) trough = sig;
  if (sig > thresh && sig > peak) peak = sig;

  if (sinceBeat > 250 && sig > thresh && !inBeat && sinceBeat > (ibi / 5) * 3) {
    inBeat = true;
    uint32_t interval = sinceBeat;
    lastBeatMs = now;
    if (interval >= 60000UL / BPM_MAX_VALID && interval <= 60000UL / BPM_MIN_VALID) {
      ibi = interval;
      ibiHist[ibiPos] = interval;
      ibiPos = (ibiPos + 1) % 6;
      if (ibiCount < 6) ibiCount++;
      if (ibiCount >= 3) {
        uint32_t total = 0;
        for (uint8_t i = 0; i < ibiCount; i++) total += ibiHist[i];
        lastHrBpm = 60000.0f / (total / (float)ibiCount);
      }
    }
  }

  if (sig < thresh && inBeat) {
    inBeat = false;
    int amp = peak - trough;
    thresh = amp / 2 + trough;
    peak = thresh;
    trough = thresh;
  }

  if (sinceBeat > 2500) {  // no beat for 2.5 s: reset, report nothing
    thresh = 2048;
    peak = trough = 2048;
    lastBeatMs = now;
    ibi = 600;
    ibiCount = 0;
    ibiPos = 0;
    lastHrBpm = NAN;
  }
}

// ---------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------

void setVibration(uint8_t duty) { ledcWrite(PIN_VIBRATION, duty); }

void updateStatusLed(bool connected) {
  // Solid on when connected, slow blink while advertising. Active-low.
  bool on = connected || ((millis() / 500) % 2 == 0);
  digitalWrite(PIN_STATUS_LED, on ? LOW : HIGH);
}

void updateDisplay(bool connected) {
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print("SWEATSALT ");
  display.println(connected ? "[BLE ON]" : "[ADV]");
  display.drawFastHLine(0, 10, OLED_WIDTH, SSD1306_WHITE);

  display.setCursor(0, 14);
  if (tempOk && !isnan(lastTempC)) display.printf("Temp %.2f C\n", lastTempC);
  else display.println("Temp --");
  if (!isnan(lastHrBpm)) display.printf("HR   %.0f bpm\n", lastHrBpm);
  else display.println("HR   --");
  display.printf("GSR  %.2f uS\n", isnan(lastGsrUs) ? 0.0f : lastGsrUs);
  if (imuOk && !isnan(lastAccelG)) display.printf("Acc  %.2f g\n", lastAccelG);
  else display.println("Acc  --");
  display.printf("Batt %u%%\n", lastBatteryPct);
  display.display();
}

// ---------------------------------------------------------------------
// BLE
// ---------------------------------------------------------------------

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *, NimBLEConnInfo &) override {
    Serial.println("BLE connected");
  }
  void onDisconnect(NimBLEServer *, NimBLEConnInfo &, int) override {
    Serial.println("BLE disconnected, re-advertising");
    setVibration(0);
    NimBLEDevice::startAdvertising();
  }
};

class VibrationCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &) override {
    NimBLEAttValue v = c->getValue();
    if (v.size() >= 1) setVibration(v.data()[0]);
  }
};

void notifyFloat(NimBLECharacteristic *c, float value) {
  c->setValue((const uint8_t *)&value, sizeof(value));
  c->notify();
}

void setupBle() {
  NimBLEDevice::init(BLE_DEVICE_NAME);
  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  NimBLEService *svc = bleServer->createService(SWEATSALT_SERVICE_UUID);
  gsrChar = svc->createCharacteristic(CHAR_GSR_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  hrChar = svc->createCharacteristic(CHAR_HR_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  tempChar = svc->createCharacteristic(CHAR_TEMP_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  imuChar = svc->createCharacteristic(CHAR_IMU_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic *vib = svc->createCharacteristic(
      CHAR_VIBRATION_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  vib->setCallbacks(new VibrationCallbacks());

  // Device Information (0x180A): serial is derived from the chip MAC so
  // every unit is unique without editing the firmware.
  uint64_t mac = ESP.getEfuseMac();
  char serial[16];
  snprintf(serial, sizeof(serial), "SWST-%02X%02X%02X",
           (uint8_t)(mac >> 24), (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
  NimBLEService *info = bleServer->createService(NimBLEUUID((uint16_t)0x180A));
  info->createCharacteristic(NimBLEUUID((uint16_t)0x2A29), NIMBLE_PROPERTY::READ)->setValue(BLE_MANUFACTURER);
  info->createCharacteristic(NimBLEUUID((uint16_t)0x2A24), NIMBLE_PROPERTY::READ)->setValue(BLE_MODEL_NUMBER);
  info->createCharacteristic(NimBLEUUID((uint16_t)0x2A25), NIMBLE_PROPERTY::READ)->setValue(serial);
  Serial.printf("Serial: %s\n", serial);

  // Battery Service (0x180F)
  NimBLEService *batt = bleServer->createService(NimBLEUUID((uint16_t)0x180F));
  batteryChar = batt->createCharacteristic(
      NimBLEUUID((uint16_t)0x2A19), NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  bleServer->start();  // starts all services registered above

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setName(BLE_DEVICE_NAME);
  adv->addServiceUUID(SWEATSALT_SERVICE_UUID);
  adv->enableScanResponse(true);
  adv->start();
}

void notifyBattery() {
  lastBatteryPct = batteryPercent(readBatteryVolts());
  batteryChar->setValue(&lastBatteryPct, 1);
  batteryChar->notify();
}

// ---------------------------------------------------------------------
// Arduino entry points
// ---------------------------------------------------------------------

void setup() {
  Serial.begin(115200);  // no wait: must boot headless on battery

  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, HIGH);
  analogReadResolution(12);
  ledcAttach(PIN_VIBRATION, 1000, 8);
  setVibration(0);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  oledOk = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  tempOk = i2cPresent(TMP117_ADDR);
  initMpu();
  Serial.printf("OLED:%d TMP117:%d MPU6050:%d\n", oledOk, tempOk, imuOk);

  setupBle();
  lastBatteryPct = batteryPercent(readBatteryVolts());

  // Short buzz so you know it booted.
  setVibration(180);
  delay(150);
  setVibration(0);
}

void loop() {
  static uint32_t tPulse = 0, tImu = 0, tSlow = 0, tBatt = 0, tOled = 0;
  uint32_t now = millis();
  bool connected = bleServer->getConnectedCount() > 0;

  if (now - tPulse >= PULSE_SAMPLE_MS) {
    tPulse = now;
    pulseSample();
  }

  if (now - tImu >= IMU_PERIOD_MS) {
    tImu = now;
    float g;
    if (imuOk && readAccelG(g)) {
      lastAccelG = g;
      if (connected) notifyFloat(imuChar, g);
    }
  }

  if (now - tSlow >= SLOW_PERIOD_MS) {
    tSlow = now;
    float t;
    if (tempOk && readTmp117(t)) lastTempC = t;
    lastGsrUs = readGsrMicrosiemens();
    if (connected) {
      if (!isnan(lastTempC)) notifyFloat(tempChar, lastTempC);
      notifyFloat(gsrChar, lastGsrUs);
      if (!isnan(lastHrBpm)) notifyFloat(hrChar, lastHrBpm);  // only real beats
    }
    Serial.printf("temp=%.2fC gsr=%.2fuS hr=%.0f g=%.2f batt=%u%%\n",
                  lastTempC, lastGsrUs, lastHrBpm, lastAccelG, lastBatteryPct);
  }

  if (now - tBatt >= BATTERY_PERIOD_MS) {
    tBatt = now;
    notifyBattery();
  }

  if (now - tOled >= OLED_PERIOD_MS) {
    tOled = now;
    updateDisplay(connected);
  }

  updateStatusLed(connected);
}
