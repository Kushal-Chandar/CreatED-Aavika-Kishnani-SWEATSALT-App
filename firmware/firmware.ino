// =============================================================================
//  SWEATSALT FIRMWARE — Seeed Studio XIAO ESP32-C3
// =============================================================================
//
//  REQUIRED SETUP
//    Board package : esp32 by Espressif, 3.x   (Board: "XIAO_ESP32C3")
//    Tools menu    : USB CDC On Boot -> Enabled  (for Serial output)
//    Libraries (Arduino IDE -> Library Manager):
//      1. Adafruit SSD1306                    (OLED, 0x3D)
//      2. Adafruit GFX Library                (SSD1306 dependency)
//      3. SparkFun High Precision Temperature Sensor TMP117 Qwiic
//                                             (include: SparkFun_TMP117.h)
//      4. NimBLE-Arduino, 2.x                 (BLE)
//    The MPU-6050 is read over raw I2C (Wire) — no library needed.
//
//  Built from the tested sketches in Downloads.zip (battery, GSR, heart rate,
//  MPU, OLED, TMP117, vibration motor), which are the final sensor decisions.
//  Those sketches reuse some pins (HR and battery both on D2, GSR and motor
//  both on GPIO3), so the pin map below resolves the clashes. BLE is added
//  for the SweatSalt PWA.
//
//  PIN MAP:
//    D0  GPIO2   Heart rate (analog)
//    D1  GPIO3   GSR (analog)
//    D2  GPIO4   Battery divider (analog, 1:2)
//    D3  GPIO5   Push-button (INPUT_PULLUP) — cycles OLED page
//    D4  GPIO6   I2C SDA  — OLED 0x3D, MPU-6050 0x68, TMP117 0x48
//    D5  GPIO7   I2C SCL
//    D6  GPIO21  Vibration motor (PWM, via driver)
//    D10 GPIO10  User LED (active-low)
//
//  BLE contract with the app (src/datasource/bleDataSource.ts) — UUIDs below
//  must stay byte-for-byte identical. Sensor characteristics are NOTIFY,
//  4-byte float32 little-endian:
//    gsr  = microsiemens   hr = bpm   temp = degC   imu = accel magnitude (g)
//  plus Device Information (0x180A) and Battery (0x180F, percent).
// =============================================================================

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <SparkFun_TMP117.h>
#include <NimBLEDevice.h>


// =============================================================================
//  PIN DEFINITIONS
// =============================================================================

#define PULSE_PIN   D0    // Heart Rate sensor — analog (ADC1 CH2, GPIO2)
#define GSR_PIN     D1    // GSR sensor        — analog (ADC1 CH3, GPIO3)
#define BAT_PIN     D2    // Battery sense     — analog (ADC1 CH4, GPIO4)
#define SWITCH_PIN  D3    // Push-button       — digital, pull-up
#define MOTOR_PIN   D6    // Vibration motor   — PWM (GPIO21)
#define USER_LED    D10   // User LED          — LOW = ON


// =============================================================================
//  BLE IDENTITY + UUIDS
// =============================================================================

#define BLE_DEVICE_NAME   "SweatSalt"
#define BLE_MANUFACTURER  "SweatSalt Project"
#define BLE_MODEL_NUMBER  "SS-MVP-1"      // app shows this as the device name

#define SWEATSALT_SERVICE_UUID "5a7b0000-0001-4a6e-9c1a-000000000000"
#define CHAR_GSR_UUID          "5a7b0000-0001-4a6e-9c1a-000000000001"
#define CHAR_HR_UUID           "5a7b0000-0001-4a6e-9c1a-000000000002"
#define CHAR_TEMP_UUID         "5a7b0000-0001-4a6e-9c1a-000000000003"
#define CHAR_IMU_UUID          "5a7b0000-0001-4a6e-9c1a-000000000004"
// Not used by the app yet: write one byte 0-255 to set motor PWM (0 = off).
#define CHAR_VIBRATION_UUID    "5a7b0000-0001-4a6e-9c1a-000000000005"

NimBLEServer         *bleServer;
NimBLECharacteristic *gsrChar, *hrChar, *tempChar, *imuChar, *batteryChar;


// =============================================================================
//  OLED DISPLAY
// =============================================================================

#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT  64
#define OLED_RESET     -1
#define OLED_ADDR    0x3D

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
bool oledOk = false;

unsigned long lastDisplayUpdate = 0;
#define DISPLAY_MS  200            // ~5 Hz: a full redraw is slow on I2C and
                                   // must not starve the 20 ms pulse sampling


// =============================================================================
//  MPU-6050
// =============================================================================

#define MPU_ADDR 0x68

int16_t ax, ay, az;
int16_t gx, gy, gz;
bool    mpuOk = false;
float   accelG = NAN;              // accel magnitude in g (±2 g range, 16384 LSB/g)

unsigned long lastAccelSample = 0;
#define ACCEL_SAMPLE_MS  100       // 10 Hz (also the IMU notify rate)


// =============================================================================
//  TMP117
// =============================================================================

TMP117 tempSensor;                 // address 0x48
bool   tempOk = false;

float tempC = NAN;
float tempF = NAN;

unsigned long lastTempSample = 0;
#define TEMP_SAMPLE_MS  1000


// =============================================================================
//  VIBRATION MOTOR (non-blocking)
// =============================================================================

#define PWM_FREQ        1000
#define PWM_RESOLUTION     8

// Pulse pattern state machine — replaces delay()-based buzzing so alerts
// don't stall pulse sampling or BLE.
volatile int  buzzRemaining = 0;   // pulses left, including the one running
                                   // (volatile: the BLE write callback clears it)
int           buzzIntensity = 0;
unsigned long buzzOnMs      = 0;
unsigned long buzzOffMs     = 0;
bool          buzzIsOn      = false;
unsigned long buzzChangedAt = 0;

void buzzMotor(int count, int intensity = 200, int onMs = 150, int offMs = 100) {
  buzzRemaining = count;
  buzzIntensity = intensity;
  buzzOnMs      = onMs;
  buzzOffMs     = offMs;
  buzzIsOn      = true;
  buzzChangedAt = millis();
  ledcWrite(MOTOR_PIN, intensity);
}

void updateBuzz() {
  if (buzzRemaining <= 0) return;
  unsigned long now = millis();
  if (buzzIsOn && now - buzzChangedAt >= buzzOnMs) {
    ledcWrite(MOTOR_PIN, 0);
    buzzIsOn = false;
    buzzChangedAt = now;
    buzzRemaining = buzzRemaining - 1;
  } else if (!buzzIsOn && now - buzzChangedAt >= buzzOffMs) {
    ledcWrite(MOTOR_PIN, buzzIntensity);
    buzzIsOn = true;
    buzzChangedAt = now;
  }
}


// =============================================================================
//  HEART RATE / PULSE DETECTION
// =============================================================================
//
//  Rising-edge threshold crossing, averaged over the last BPM_HISTORY_SIZE
//  intervals. If no beat arrives for PULSE_TIMEOUT_MS (finger off) the BPM is
//  marked invalid again so stale values aren't shown, buzzed on or sent.

#define PULSE_SAMPLE_MS     20     // 50 Hz
#define PULSE_THRESHOLD   2048     // 12-bit mid-point; tune to your waveform
#define MIN_BEAT_MS        300     // ~200 BPM max
#define MAX_BEAT_MS       1500     // ~40 BPM min; longer gap restarts the average
#define PULSE_TIMEOUT_MS  3000
#define BPM_HISTORY_SIZE     5

int  pulseRaw      = 0;
int  bpm           = 0;
bool bpmValid      = false;
bool pulseBeatHigh = false;

unsigned long lastBeatTime = 0;    // 0 = no beat seen yet
unsigned long beatIntervals[BPM_HISTORY_SIZE] = {0};
int  beatIndex = 0;

unsigned long lastPulseSample = 0;

void updatePulse() {
  pulseRaw = analogRead(PULSE_PIN);
  unsigned long now = millis();

  if (pulseRaw > PULSE_THRESHOLD && !pulseBeatHigh) {
    pulseBeatHigh = true;

    if (lastBeatTime != 0) {
      unsigned long interval = now - lastBeatTime;
      if (interval > MAX_BEAT_MS) {
        beatIndex = 0;                         // too slow: start averaging over
      } else if (interval > MIN_BEAT_MS) {
        beatIntervals[beatIndex % BPM_HISTORY_SIZE] = interval;
        beatIndex++;
        if (beatIndex >= BPM_HISTORY_SIZE) {
          unsigned long sum = 0;
          for (int i = 0; i < BPM_HISTORY_SIZE; i++) sum += beatIntervals[i];
          bpm      = (int)(60000UL / (sum / BPM_HISTORY_SIZE));
          bpmValid = true;
        }
      } else {
        return;                                // double-detection: ignore
      }
    }
    lastBeatTime = now;

  } else if (pulseRaw <= PULSE_THRESHOLD) {
    pulseBeatHigh = false;
  }

  if (bpmValid && now - lastBeatTime > PULSE_TIMEOUT_MS) {
    bpmValid  = false;
    beatIndex = 0;
  }
}


// =============================================================================
//  GSR
// =============================================================================

int   gsrRaw          = 0;
float gsrVoltage      = 0.0;
float gsrMicrosiemens = 0.0;

unsigned long lastGsrSample = 0;
#define GSR_SAMPLE_MS  500

void readGSR() {
  gsrRaw     = analogRead(GSR_PIN);
  gsrVoltage = (gsrRaw / 4095.0) * 3.3;

  // Skin conductance for the app. Grove GSR divider formula scaled to a
  // 12-bit ADC (ratio-based, so supply-independent). Uncalibrated estimate:
  // trends are meaningful, absolute µS needs calibrating against known
  // resistors.
  float denom = 2048.0f - gsrRaw;
  if (denom <= 1.0f) {
    gsrMicrosiemens = 0.0f;                    // open circuit: not on skin
  } else {
    float ohms = ((4096.0f + 2.0f * gsrRaw) * 10000.0f) / denom;
    gsrMicrosiemens = 1000000.0f / ohms;
  }
}


// =============================================================================
//  BATTERY
// =============================================================================

float   batteryVoltage = 0.0;
uint8_t batteryPct     = 0;

unsigned long lastBatSample = 0;
#define BAT_SAMPLE_MS  3000        // start a new measurement this often
#define BAT_BURST         20       // ADC samples averaged per measurement
#define BAT_TICK_MS        5       // gap between those samples

void applyBatteryMv(float avgMv) {
  batteryVoltage = (avgMv * 2.0) / 1000.0;     // ×2 for the 1:2 divider

  // 3.3 V empty .. 4.2 V full (Li-Ion) -> 0..100 %
  float pct = (batteryVoltage - 3.3f) / (4.2f - 3.3f) * 100.0f;
  batteryPct = (uint8_t)constrain(pct, 0.0f, 100.0f);
}

// Blocking read — only used once in setup() so the first BLE notify has a
// value.
void readBatteryBlocking() {
  uint32_t totalMv = 0;
  for (int i = 0; i < BAT_BURST; i++) {
    totalMv += analogReadMilliVolts(BAT_PIN);
    delay(BAT_TICK_MS);
  }
  applyBatteryMv((float)totalMv / BAT_BURST);
}

// Non-blocking read for loop(): takes one ADC sample per BAT_TICK_MS instead
// of sitting in a 100 ms delay loop, which would miss pulse samples (and so
// distort BPM) every few seconds.
void updateBattery(unsigned long now) {
  static bool          bursting = false;
  static unsigned long lastTick = 0;
  static uint32_t      totalMv  = 0;
  static int           taken    = 0;

  if (!bursting) {
    if (now - lastBatSample < BAT_SAMPLE_MS) return;
    bursting      = true;
    lastBatSample = now;
    lastTick      = now - BAT_TICK_MS;       // take the first sample right away
    totalMv       = 0;
    taken         = 0;
  }
  if (now - lastTick < BAT_TICK_MS) return;
  lastTick = now;
  totalMv += analogReadMilliVolts(BAT_PIN);
  if (++taken >= BAT_BURST) {
    applyBatteryMv((float)totalMv / BAT_BURST);
    bursting = false;
  }
}


// =============================================================================
//  SENSOR READS
// =============================================================================

void readMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  if (Wire.requestFrom(MPU_ADDR, 6, true) != 6) return;   // keep last values
  ax = (Wire.read() << 8) | Wire.read();
  ay = (Wire.read() << 8) | Wire.read();
  az = (Wire.read() << 8) | Wire.read();

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x43);
  Wire.endTransmission(false);
  if (Wire.requestFrom(MPU_ADDR, 6, true) == 6) {
    gx = (Wire.read() << 8) | Wire.read();
    gy = (Wire.read() << 8) | Wire.read();
    gz = (Wire.read() << 8) | Wire.read();
  }

  float x = ax / 16384.0f, y = ay / 16384.0f, z = az / 16384.0f;
  accelG = sqrtf(x * x + y * y + z * z);
}

void readTemperature() {
  if (tempOk && tempSensor.dataReady()) {
    tempC = tempSensor.readTempC();
    tempF = tempSensor.readTempF();
  }
}


// =============================================================================
//  ALERTS (haptic)
// =============================================================================

#define BPM_HIGH_ALERT   110
#define BPM_LOW_ALERT     50
#define TEMP_FEVER_C    37.8

unsigned long lastAlertCheck = 0;
#define ALERT_CHECK_MS  5000

bool feverNow() { return !isnan(tempC) && tempC > TEMP_FEVER_C && tempC < 45.0; }

void checkAlerts() {
  if (buzzRemaining > 0) return;
  if (bpmValid) {
    if (bpm > BPM_HIGH_ALERT)      { buzzMotor(2, 220); return; }
    else if (bpm < BPM_LOW_ALERT)  { buzzMotor(1, 180, 400); return; }
  }
  if (feverNow()) buzzMotor(3, 220);
}


// =============================================================================
//  BUTTON + OLED PAGES
// =============================================================================

enum DisplayPage {
  PAGE_HEART_RATE = 0,
  PAGE_TEMPERATURE,
  PAGE_GSR,
  PAGE_ACCEL,
  PAGE_BATTERY,
  PAGE_COUNT
};
DisplayPage currentPage = PAGE_HEART_RATE;

#define DEBOUNCE_MS  50
bool          lastButtonState  = HIGH;
bool          buttonState      = HIGH;
unsigned long lastDebounceTime = 0;

void handleButton() {
  bool reading = digitalRead(SWITCH_PIN);
  if (reading != lastButtonState) lastDebounceTime = millis();

  if ((millis() - lastDebounceTime) > DEBOUNCE_MS && reading != buttonState) {
    buttonState = reading;
    if (buttonState == LOW) currentPage = (DisplayPage)((currentPage + 1) % PAGE_COUNT);
  }
  lastButtonState = reading;
}

void drawPage_HeartRate() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("  == HEART RATE =="));
  display.drawFastHLine(0, 10, SCREEN_WIDTH, SSD1306_WHITE);
  display.setCursor(0, 14);
  display.print(F("Signal: "));
  display.println(pulseRaw);
  display.setCursor(0, 28);
  display.print(F("BPM: "));
  if (bpmValid) {
    display.setTextSize(2);
    display.println(bpm);
  } else {
    display.setTextSize(1);
    display.println(F("Measuring..."));
  }
}

void drawPage_Temperature() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F(" == TEMPERATURE =="));
  display.drawFastHLine(0, 10, SCREEN_WIDTH, SSD1306_WHITE);
  if (!tempOk || isnan(tempC)) {
    display.setCursor(0, 20);
    display.println(tempOk ? F("Waiting...") : F("TMP117 not found"));
    return;
  }
  display.setCursor(0, 16);
  display.setTextSize(2);
  display.print(tempC, 1);
  display.setTextSize(1);
  display.println(F(" C"));
  display.setCursor(0, 40);
  display.print(tempF, 1);
  display.println(F(" F"));
  if (feverNow()) {
    display.setCursor(0, 54);
    display.print(F("*** FEVER ALERT ***"));
  }
}

void drawPage_GSR() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("  == GSR SENSOR =="));
  display.drawFastHLine(0, 10, SCREEN_WIDTH, SSD1306_WHITE);
  display.setCursor(0, 16);
  display.print(F("Raw ADC : "));
  display.println(gsrRaw);
  display.setCursor(0, 28);
  display.print(F("Voltage : "));
  display.print(gsrVoltage, 3);
  display.println(F(" V"));
  display.setCursor(0, 40);
  display.print(F("Cond    : "));
  display.print(gsrMicrosiemens, 2);
  display.println(F(" uS"));
}

void drawPage_Accel() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("  == MPU-6050 =="));
  display.drawFastHLine(0, 10, SCREEN_WIDTH, SSD1306_WHITE);
  if (!mpuOk) {
    display.setCursor(0, 20);
    display.println(F("MPU-6050 not found"));
    return;
  }
  display.setCursor(0, 14);
  display.print(F("Ax:")); display.print(ax);
  display.print(F(" Ay:")); display.print(ay);
  display.setCursor(0, 26);
  display.print(F("Az:")); display.println(az);
  display.setCursor(0, 40);
  display.print(F("Gx:")); display.print(gx);
  display.print(F(" Gy:")); display.print(gy);
  display.setCursor(0, 52);
  display.print(F("Gz:")); display.println(gz);
}

void drawPage_Battery() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("   == BATTERY =="));
  display.drawFastHLine(0, 10, SCREEN_WIDTH, SSD1306_WHITE);
  display.setCursor(0, 18);
  display.setTextSize(2);
  display.print(batteryVoltage, 2);
  display.setTextSize(1);
  display.print(F(" V  "));
  display.print(batteryPct);
  display.println(F("%"));
  display.setCursor(0, 44);
  display.print(F("Status: "));
  if      (batteryVoltage >= 4.0) display.println(F("Full"));
  else if (batteryVoltage >= 3.6) display.println(F("Good"));
  else if (batteryVoltage >= 3.3) display.println(F("Low"));
  else                            display.println(F("Critical!"));
}

void updateDisplay() {
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  switch (currentPage) {
    case PAGE_HEART_RATE:  drawPage_HeartRate();   break;
    case PAGE_TEMPERATURE: drawPage_Temperature(); break;
    case PAGE_GSR:         drawPage_GSR();         break;
    case PAGE_ACCEL:       drawPage_Accel();       break;
    case PAGE_BATTERY:     drawPage_Battery();     break;
    default:               break;
  }
  // BLE link indicator, top-right corner: filled = connected, ring = advertising
  if (bleServer && bleServer->getConnectedCount() > 0) display.fillCircle(123, 4, 3, SSD1306_WHITE);
  else display.drawCircle(123, 4, 3, SSD1306_WHITE);
  display.display();
}


// =============================================================================
//  BLE
// =============================================================================

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *, NimBLEConnInfo &) override {
    Serial.println(F("BLE connected"));
  }
  void onDisconnect(NimBLEServer *, NimBLEConnInfo &, int) override {
    Serial.println(F("BLE disconnected — advertising again"));
    buzzRemaining = 0;                         // don't leave a BLE-held motor running
    ledcWrite(MOTOR_PIN, 0);
    NimBLEDevice::startAdvertising();
  }
};

class VibrationCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &) override {
    NimBLEAttValue v = c->getValue();
    if (v.size() < 1) return;
    buzzRemaining = 0;                         // manual control cancels any pattern
    ledcWrite(MOTOR_PIN, v.data()[0]);
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

  const uint32_t RN = NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY;
  NimBLEService *svc = bleServer->createService(SWEATSALT_SERVICE_UUID);
  gsrChar  = svc->createCharacteristic(CHAR_GSR_UUID, RN);
  hrChar   = svc->createCharacteristic(CHAR_HR_UUID, RN);
  tempChar = svc->createCharacteristic(CHAR_TEMP_UUID, RN);
  imuChar  = svc->createCharacteristic(CHAR_IMU_UUID, RN);
  NimBLECharacteristic *vib = svc->createCharacteristic(
      CHAR_VIBRATION_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  vib->setCallbacks(new VibrationCallbacks());

  // Device Information: serial derived from the chip MAC (unique per unit).
  uint64_t mac = ESP.getEfuseMac();
  char serial[16];
  snprintf(serial, sizeof(serial), "SWST-%02X%02X%02X",
           (uint8_t)(mac >> 24), (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
  NimBLEService *info = bleServer->createService(NimBLEUUID((uint16_t)0x180A));
  info->createCharacteristic(NimBLEUUID((uint16_t)0x2A29), NIMBLE_PROPERTY::READ)->setValue(BLE_MANUFACTURER);
  info->createCharacteristic(NimBLEUUID((uint16_t)0x2A24), NIMBLE_PROPERTY::READ)->setValue(BLE_MODEL_NUMBER);
  info->createCharacteristic(NimBLEUUID((uint16_t)0x2A25), NIMBLE_PROPERTY::READ)->setValue(serial);
  Serial.print(F("Serial: ")); Serial.println(serial);

  NimBLEService *batt = bleServer->createService(NimBLEUUID((uint16_t)0x180F));
  batteryChar = batt->createCharacteristic(NimBLEUUID((uint16_t)0x2A19), RN);

  bleServer->start();                          // starts all services above

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setName(BLE_DEVICE_NAME);
  adv->addServiceUUID(SWEATSALT_SERVICE_UUID);
  adv->enableScanResponse(true);
  adv->start();
}

// Push the latest readings to the app. Only valid values are sent — a sensor
// that is missing or has no signal (no pulse, no TMP117) simply sends nothing.
unsigned long lastNotify = 0;
#define NOTIFY_MS  1000

void notifyReadings() {
  if (bleServer->getConnectedCount() == 0) return;
  if (tempOk && !isnan(tempC))  notifyFloat(tempChar, tempC);
  notifyFloat(gsrChar, gsrMicrosiemens);
  if (bpmValid)                 notifyFloat(hrChar, (float)bpm);
  if (mpuOk && !isnan(accelG))  notifyFloat(imuChar, accelG);
  batteryChar->setValue(&batteryPct, 1);
  batteryChar->notify();
}


// =============================================================================
//  SETUP
// =============================================================================

void setup() {
  Serial.begin(115200);
  // Wait for a USB serial monitor, but not forever: the device has to boot
  // normally on battery with no computer attached.
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 2000) delay(10);
  Serial.println(F("\n=== SweatSalt firmware — boot ==="));

  pinMode(USER_LED, OUTPUT);
  digitalWrite(USER_LED, LOW);                 // ON during boot

  pinMode(SWITCH_PIN, INPUT_PULLUP);
  analogReadResolution(12);

  Wire.begin();                                // D4 = SDA, D5 = SCL
  Wire.setClock(400000);                       // faster OLED refresh

  ledcAttach(MOTOR_PIN, PWM_FREQ, PWM_RESOLUTION);
  ledcWrite(MOTOR_PIN, 0);

  oledOk = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (oledOk) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(20, 24);
    display.println(F("Initialising..."));
    display.display();
  }
  Serial.println(oledOk ? F("OLED        OK") : F("WARNING: OLED not found at 0x3D — continuing without display"));

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);                            // PWR_MGMT_1: clear SLEEP
  Wire.write(0x00);
  mpuOk = (Wire.endTransmission(true) == 0);
  Serial.println(mpuOk ? F("MPU-6050    OK") : F("WARNING: MPU-6050 not responding"));

  tempOk = tempSensor.begin();
  Serial.println(tempOk ? F("TMP117      OK") : F("WARNING: TMP117 not found at 0x48 — continuing without temp"));

  setupBle();
  Serial.println(F("BLE         advertising"));

  readBatteryBlocking();                       // so the first notify has a value
  buzzMotor(1, 150, 200);                      // boot buzz
  digitalWrite(USER_LED, HIGH);                // OFF: boot complete
  Serial.println(F("=== Boot complete ===\n"));
}


// =============================================================================
//  MAIN LOOP  (non-blocking — all timing via millis())
// =============================================================================

void loop() {
  unsigned long now = millis();

  handleButton();
  updateBuzz();

  if (now - lastPulseSample >= PULSE_SAMPLE_MS) { lastPulseSample = now; updatePulse(); }
  if (now - lastGsrSample   >= GSR_SAMPLE_MS)   { lastGsrSample   = now; readGSR(); }
  updateBattery(now);
  if (now - lastTempSample  >= TEMP_SAMPLE_MS)  { lastTempSample  = now; readTemperature(); }
  if (mpuOk && now - lastAccelSample >= ACCEL_SAMPLE_MS) { lastAccelSample = now; readMPU6050(); }
  if (now - lastDisplayUpdate >= DISPLAY_MS)    { lastDisplayUpdate = now; updateDisplay(); }
  if (now - lastAlertCheck  >= ALERT_CHECK_MS)  { lastAlertCheck  = now; checkAlerts(); }
  if (now - lastNotify      >= NOTIFY_MS)       { lastNotify      = now; notifyReadings(); }

  static unsigned long lastSerial = 0;
  if (now - lastSerial >= 1000) {
    lastSerial = now;
    Serial.print(F("BPM="));        Serial.print(bpmValid ? String(bpm) : String("---"));
    Serial.print(F("  Temp="));     Serial.print(tempC, 2); Serial.print(F("C"));
    Serial.print(F("  GSR="));      Serial.print(gsrRaw);
    Serial.print(F("("));           Serial.print(gsrMicrosiemens, 2); Serial.print(F("uS)"));
    Serial.print(F("  Acc="));      Serial.print(accelG, 2); Serial.print(F("g"));
    Serial.print(F("  Bat="));      Serial.print(batteryVoltage, 2); Serial.print(F("V "));
    Serial.print(batteryPct);       Serial.print(F("%  BLE="));
    Serial.println(bleServer->getConnectedCount());
  }
}
