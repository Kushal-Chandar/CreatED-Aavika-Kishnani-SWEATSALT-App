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
//  PIN MAP:
//    D0  GPIO2   Heart rate (analog)
//    D1  GPIO3   GSR (analog)
//    D2  GPIO4   Battery divider (analog, 1:2)
//    D3  GPIO5   Push-button to GND (INPUT_PULLUP, active-low)
//                short press = dismiss alert / next screen, long = home screen
//    D4  GPIO6   I2C SDA  — OLED 0x3D, MPU-6050 0x68, TMP117 0x48
//    D5  GPIO7   I2C SCL
//    D6  GPIO21  Vibration motor (PWM, via driver)
//    D10 GPIO10  User LED (active-high)
// =============================================================================

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <SparkFun_TMP117.h>
#include <NimBLEDevice.h>


// =============================================================================
//  PIN DEFINITIONS
// =============================================================================

#define PULSE_PIN   D0
#define GSR_PIN     D1
#define BAT_PIN     D2
#define BUTTON_PIN  D3    // push-button to GND, internal pull-up (active-low)
#define MOTOR_PIN   D6
#define USER_LED    D10


// =============================================================================
//  BLE IDENTITY + UUIDS
// =============================================================================

#define BLE_DEVICE_NAME   "SweatSalt"
#define BLE_MANUFACTURER  "SweatSalt Project"
#define BLE_MODEL_NUMBER  "SS-MVP-1"      

#define SWEATSALT_SERVICE_UUID "5a7b0000-0001-4a6e-9c1a-000000000000"
#define CHAR_GSR_UUID          "5a7b0000-0001-4a6e-9c1a-000000000001"
#define CHAR_HR_UUID           "5a7b0000-0001-4a6e-9c1a-000000000002"
#define CHAR_TEMP_UUID         "5a7b0000-0001-4a6e-9c1a-000000000003"
#define CHAR_IMU_UUID          "5a7b0000-0001-4a6e-9c1a-000000000004"
#define CHAR_VIBRATION_UUID    "5a7b0000-0001-4a6e-9c1a-000000000005"  // WRITE: 1 byte PWM 0-255
#define CHAR_ALERT_UUID        "5a7b0000-0001-4a6e-9c1a-000000000007"  // READ|NOTIFY: 1 byte AlertType

NimBLEServer         *bleServer;
NimBLECharacteristic *gsrChar, *hrChar, *tempChar, *imuChar, *batteryChar, *alertChar;


// =============================================================================
//  ALERT TYPE ENUM (Moved up here so the compiler sees it early)
// =============================================================================

enum AlertType {
  ALERT_NONE = 0,
  ALERT_FEVER,
  ALERT_HIGH_HR,
  ALERT_LOW_HR,
  ALERT_BATTERY
};


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
#define DISPLAY_MS  120            // ~8 fps: smooth enough, light on the pulse sampler


// =============================================================================
//  MPU-6050
// =============================================================================

#define MPU_ADDR 0x68

int16_t ax, ay, az;
int16_t gx, gy, gz;
bool    mpuOk = false;
float   accelG = NAN;              

unsigned long lastAccelSample = 0;
#define ACCEL_SAMPLE_MS  100       


// =============================================================================
//  TMP117
// =============================================================================

TMP117 tempSensor;                 
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

volatile int  buzzRemaining = 0;   
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
//  HISTORY BUFFERS, CLOCK, LED
// =============================================================================

#define WAVE_LEN  128                  // pulse waveform: 128 samples @ 50 Hz
uint8_t waveBuf[WAVE_LEN] = {0};
int     waveIdx = 0;

#define ACC_LEN  64                    // motion history: 64 samples @ 10 Hz
float accBuf[ACC_LEN] = {0};
int   accIdx = 0;
float activityEma = 0.0f;              // smoothed |a| - 1 g

#define LED_ON   HIGH
#define LED_OFF  LOW
unsigned long ledOffAt = 0;            // flashes briefly on every detected beat

void flashLed(unsigned long ms = 40) {
  digitalWrite(USER_LED, LED_ON);
  ledOffAt = millis() + ms;
}

void updateLed() {
  if (ledOffAt && (long)(millis() - ledOffAt) >= 0) {
    digitalWrite(USER_LED, LED_OFF);
    ledOffAt = 0;
  }
}


// =============================================================================
//  HEART RATE / PULSE DETECTION
// =============================================================================

#define PULSE_SAMPLE_MS     20     
#define PULSE_THRESHOLD   2048     
#define MIN_BEAT_MS        300     
#define MAX_BEAT_MS       1500     
#define PULSE_TIMEOUT_MS  3000
#define BPM_HISTORY_SIZE     5

int  pulseRaw      = 0;
int  bpm           = 0;
bool bpmValid      = false;
bool pulseBeatHigh = false;

unsigned long lastBeatTime = 0;    
unsigned long beatIntervals[BPM_HISTORY_SIZE] = {0};
int  beatIndex = 0;

unsigned long lastPulseSample = 0;

void updatePulse() {
  pulseRaw = analogRead(PULSE_PIN);
  unsigned long now = millis();

  waveBuf[waveIdx] = (uint8_t)(pulseRaw >> 6);     // 12-bit -> 0..63
  waveIdx = (waveIdx + 1) % WAVE_LEN;

  if (pulseRaw > PULSE_THRESHOLD && !pulseBeatHigh) {
    pulseBeatHigh = true;
    flashLed();

    if (lastBeatTime != 0) {
      unsigned long interval = now - lastBeatTime;
      if (interval > MAX_BEAT_MS) {
        beatIndex = 0;                         
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
        return;                                
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

  float denom = 2048.0f - gsrRaw;
  if (denom <= 1.0f) {
    gsrMicrosiemens = 0.0f;                    
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
#define BAT_SAMPLE_MS  3000        
#define BAT_BURST         20       
#define BAT_TICK_MS        5       

void applyBatteryMv(float avgMv) {
  batteryVoltage = (avgMv * 2.0) / 1000.0;     
  float pct = (batteryVoltage - 3.3f) / (4.2f - 3.3f) * 100.0f;
  batteryPct = (uint8_t)constrain(pct, 0.0f, 100.0f);
}

void readBatteryBlocking() {
  uint32_t totalMv = 0;
  for (int i = 0; i < BAT_BURST; i++) {
    totalMv += analogReadMilliVolts(BAT_PIN);
    delay(BAT_TICK_MS);
  }
  applyBatteryMv((float)totalMv / BAT_BURST);
}

void updateBattery(unsigned long now) {
  static bool          bursting = false;
  static unsigned long lastTick = 0;
  static uint32_t      totalMv  = 0;
  static int           taken    = 0;

  if (!bursting) {
    if (now - lastBatSample < BAT_SAMPLE_MS) return;
    bursting      = true;
    lastBatSample = now;
    lastTick      = now - BAT_TICK_MS;       
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
  if (Wire.requestFrom(MPU_ADDR, 6, true) != 6) return;   
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

  float dev = fabsf(accelG - 1.0f);
  accBuf[accIdx] = dev;
  accIdx = (accIdx + 1) % ACC_LEN;
  activityEma += 0.2f * (dev - activityEma);
}

void readTemperature() {
  if (tempOk && tempSensor.dataReady()) {
    tempC = tempSensor.readTempC();
    tempF = tempSensor.readTempF();
  }
}


// =============================================================================
//  DISPLAY STATE, WAKE/SLEEP, TOASTS
// =============================================================================

enum DisplayPage {
  PAGE_FACE = 0,
  PAGE_HEART_RATE,
  PAGE_TEMPERATURE,
  PAGE_GSR,
  PAGE_ACCEL,
  PAGE_BATTERY,
  PAGE_COUNT
};
DisplayPage currentPage = PAGE_FACE;

#define DISPLAY_TIMEOUT_MS  30000UL    // OLED sleeps after this much idle time
bool          displayAwake    = true;
unsigned long lastInteraction = 0;

volatile bool wakeRequest = false;     // set from BLE callbacks, handled in loop()

const char *volatile toastText = nullptr;
unsigned long        toastUntil = 0;
#define TOAST_MS  1800

void showToast(const char *text) {
  toastText  = text;
  toastUntil = millis() + TOAST_MS;
  wakeRequest = true;
}

void wakeDisplay() {
  lastInteraction = millis();
  if (!displayAwake && oledOk) {
    display.ssd1306_command(SSD1306_DISPLAYON);
    displayAwake = true;
  }
}

void sleepDisplay() {
  if (!displayAwake || !oledOk) return;
  display.clearDisplay();
  display.display();
  display.ssd1306_command(SSD1306_DISPLAYOFF);
  displayAwake = false;
}


// =============================================================================
//  ALERTS & HAPTICS
// =============================================================================

#define BPM_HIGH_ALERT   110
#define BPM_LOW_ALERT     50
#define TEMP_FEVER_C    37.8
#define ALERT_CLEAR_CHECKS   3         // condition must be gone this many checks
#define ALERT_REBUZZ_MS  10000UL       // nag haptic until dismissed

AlertType activeAlert = ALERT_NONE;
bool      alertDismissed = false;
int       alertClearCount = 0;

unsigned long lastAlertCheck = 0;
unsigned long lastAlertBuzz  = 0;
#define ALERT_CHECK_MS  1000

void publishAlert();                   // BLE section

bool feverNow() { return !isnan(tempC) && tempC > TEMP_FEVER_C && tempC < 45.0; }

AlertType evaluateAlertCondition() {
  if (feverNow()) return ALERT_FEVER;
  if (bpmValid && bpm > BPM_HIGH_ALERT) return ALERT_HIGH_HR;
  if (bpmValid && bpm < BPM_LOW_ALERT) return ALERT_LOW_HR;
  if (batteryVoltage < 3.4f && batteryVoltage > 2.0f) return ALERT_BATTERY;
  return ALERT_NONE;
}

void triggerAlertHaptic(AlertType alert) {
  lastAlertBuzz = millis();
  switch (alert) {
    case ALERT_FEVER:   buzzMotor(3, 220); break;
    case ALERT_HIGH_HR: buzzMotor(2, 220); break;
    case ALERT_LOW_HR:  buzzMotor(1, 180, 400); break;
    case ALERT_BATTERY: buzzMotor(1, 100, 500); break;
    default: break;
  }
}

void stopMotor() {
  buzzRemaining = 0;
  ledcWrite(MOTOR_PIN, 0);
}

void checkAlerts() {
  AlertType candidate = evaluateAlertCondition();

  if (candidate == activeAlert) {
    alertClearCount = 0;
  } else if (candidate == ALERT_NONE && ++alertClearCount < ALERT_CLEAR_CHECKS) {
    // Condition vanished — wait a few checks so a flickering sensor doesn't
    // re-arm (and re-buzz) an alert the wearer already dismissed.
  } else {
    alertClearCount = 0;
    activeAlert     = candidate;
    alertDismissed  = false;
    publishAlert();
    if (activeAlert != ALERT_NONE) {
      wakeDisplay();
      triggerAlertHaptic(activeAlert);
    }
    return;
  }

  if (activeAlert != ALERT_NONE && !alertDismissed && buzzRemaining <= 0 &&
      millis() - lastAlertBuzz >= ALERT_REBUZZ_MS) {
    triggerAlertHaptic(activeAlert);
  }
}

bool alertVisible() { return activeAlert != ALERT_NONE && !alertDismissed; }


// =============================================================================
//  PUSH BUTTON  (D3 -> GND, INPUT_PULLUP, active-low)
//    short press : dismiss active alert, otherwise next screen
//    long press  : back to the home screen
//    any press   : wakes a sleeping display (first press only wakes)
// =============================================================================

#define DEBOUNCE_MS     30
#define LONG_PRESS_MS  700

bool          btnRawLast    = HIGH;
bool          btnStable     = HIGH;
unsigned long btnRawChanged = 0;
unsigned long btnDownAt     = 0;
bool          btnLongDone   = false;

void updateDisplay();

void onShortPress() {
  if (!displayAwake) { wakeDisplay(); return; }
  wakeDisplay();
  if (alertVisible()) {
    alertDismissed = true;
    stopMotor();
    publishAlert();
    showToast("Alert dismissed");
    Serial.println(F("[Button] short: dismiss alert"));
  } else {
    currentPage = (DisplayPage)((currentPage + 1) % PAGE_COUNT);
    Serial.print(F("[Button] short: screen "));
    Serial.println((int)currentPage + 1);
  }
  updateDisplay();
}

void onLongPress() {
  bool wasAsleep = !displayAwake;
  wakeDisplay();
  currentPage = PAGE_FACE;
  if (!wasAsleep) buzzMotor(1, 120, 40);
  Serial.println(F("[Button] long: home"));
  updateDisplay();
}

void handleButton() {
  unsigned long now = millis();
  bool raw = digitalRead(BUTTON_PIN);
  if (raw != btnRawLast) {
    btnRawLast    = raw;
    btnRawChanged = now;
  }
  if (now - btnRawChanged >= DEBOUNCE_MS && raw != btnStable) {
    btnStable = raw;
    if (btnStable == LOW) {
      btnDownAt   = now;
      btnLongDone = false;
    } else if (!btnLongDone) {
      onShortPress();
    }
  }
  if (btnStable == LOW && !btnLongDone && now - btnDownAt >= LONG_PRESS_MS) {
    btnLongDone = true;
    onLongPress();
  }
}


// =============================================================================
//  DRAWING HELPERS
// =============================================================================

void textAt(int x, int y, int size, const char *s) {
  display.setTextSize(size);
  display.setCursor(x, y);
  display.print(s);
}

void textCentered(int cx, int y, int size, const char *s) {
  int w = (int)strlen(s) * 6 * size;
  textAt(cx - w / 2, y, size, s);
}

// Solid heart centred on (cx, cy); r = lobe radius.
void drawHeart(int cx, int cy, int r) {
  display.fillCircle(cx - r, cy, r, SSD1306_WHITE);
  display.fillCircle(cx + r, cy, r, SSD1306_WHITE);
  display.fillTriangle(cx - 2 * r, cy + 1, cx + 2 * r, cy + 1, cx, cy + 3 * r, SSD1306_WHITE);
}

// Water drop; (cx, cy) is the bulb centre, r the bulb radius.
void drawDrop(int cx, int cy, int r) {
  display.fillCircle(cx, cy, r, SSD1306_WHITE);
  display.fillTriangle(cx, cy - 2 * r, cx - (r * 7) / 8, cy - r / 2, cx + (r * 7) / 8, cy - r / 2,
                       SSD1306_WHITE);
}

// Tiny thermometer, 5 px wide.
void drawMiniThermo(int x, int y) {
  display.drawRect(x + 1, y, 3, 6, SSD1306_WHITE);
  display.fillCircle(x + 2, y + 6, 2, SSD1306_WHITE);
}

void drawBleGlyph(int x, int y, bool connected) {
  if (!connected) {
    display.drawPixel(x + 2, y + 4, SSD1306_WHITE);   // idle: just a dot
    return;
  }
  display.drawFastVLine(x + 2, y, 9, SSD1306_WHITE);
  display.drawLine(x + 2, y, x + 4, y + 2, SSD1306_WHITE);
  display.drawLine(x + 4, y + 2, x, y + 6, SSD1306_WHITE);
  display.drawLine(x + 2, y + 8, x + 4, y + 6, SSD1306_WHITE);
  display.drawLine(x + 4, y + 6, x, y + 2, SSD1306_WHITE);
}

void drawBatteryIcon(int x, int y, int pct) {
  display.drawRect(x, y, 16, 8, SSD1306_WHITE);
  display.fillRect(x + 16, y + 2, 2, 4, SSD1306_WHITE);
  int w = (pct * 12) / 100;
  if (w > 0) display.fillRect(x + 2, y + 2, w, 4, SSD1306_WHITE);
}

// Top strip shared by every page: title, page dots, link state, battery.
void drawStatusBar(const char *title, int page) {
  display.setTextColor(SSD1306_WHITE);
  textAt(0, 0, 1, title);

  for (int i = 0; i < PAGE_COUNT; i++) {
    int x = 48 + i * 7;
    if (i == page) display.fillCircle(x + 1, 4, 2, SSD1306_WHITE);
    else           display.fillRect(x, 3, 2, 2, SSD1306_WHITE);
  }

  drawBleGlyph(92, 0, bleServer && bleServer->getConnectedCount() > 0);
  drawBatteryIcon(104, 0, batteryPct);
}


// =============================================================================
//  HOME SCREEN & PAGES
// =============================================================================

// Home screen: the vitals at a glance, fitness-band style.
void drawFace() {
  drawStatusBar("NOW", PAGE_FACE);
  char buf[16];

  // Heart rate, big.
  bool beat = lastBeatTime != 0 && millis() - lastBeatTime < 150;
  drawHeart(9, 21, beat ? 4 : 3);
  if (bpmValid) snprintf(buf, sizeof(buf), "%d", bpm);
  else          snprintf(buf, sizeof(buf), "--");
  textAt(24, 13, 3, buf);
  textAt(24, 38, 1, "BPM");

  // Activity level on the right.
  const char *label = !mpuOk                ? "--"
                    : activityEma < 0.06f   ? "STILL"
                    : activityEma < 0.25f   ? "LIGHT"
                                            : "ACTIVE";
  textAt(86, 14, 1, "MOVE");
  textAt(86, 25, 1, label);

  // Temperature and sweat cards.
  display.drawRoundRect(2, 46, 60, 17, 4, SSD1306_WHITE);
  drawMiniThermo(8, 49);
  if (tempOk && !isnan(tempC)) snprintf(buf, sizeof(buf), "%.1fC", tempC);
  else                         snprintf(buf, sizeof(buf), "--");
  textAt(20, 51, 1, buf);

  display.drawRoundRect(66, 46, 60, 17, 4, SSD1306_WHITE);
  drawDrop(74, 56, 3);
  snprintf(buf, sizeof(buf), "%.1fuS", gsrMicrosiemens);
  textAt(84, 51, 1, buf);
}

void drawPage_HeartRate() {
  drawStatusBar("HEART", PAGE_HEART_RATE);
  char buf[16];

  if (bpmValid) snprintf(buf, sizeof(buf), "%d", bpm);
  else          snprintf(buf, sizeof(buf), "--");
  textAt(4, 13, 3, buf);
  textAt(4, 38, 1, bpmValid ? "BPM" : "place finger");

  // Heart swells for ~150 ms after each detected beat.
  bool beat = lastBeatTime != 0 && millis() - lastBeatTime < 150;
  drawHeart(108, 22, beat ? 7 : 5);

  // Rolling pulse waveform, auto-scaled to its own min/max.
  uint8_t lo = 255, hi = 0;
  for (int i = 0; i < WAVE_LEN; i++) {
    if (waveBuf[i] < lo) lo = waveBuf[i];
    if (waveBuf[i] > hi) hi = waveBuf[i];
  }
  int range = hi - lo;
  if (range < 6) range = 6;
  int prevY = -1;
  for (int x = 0; x < WAVE_LEN; x++) {
    uint8_t v = waveBuf[(waveIdx + x) % WAVE_LEN];
    int y = 62 - ((v - lo) * 16) / range;
    if (prevY >= 0) display.drawLine(x - 1, prevY, x, y, SSD1306_WHITE);
    prevY = y;
  }
}

void drawPage_Temperature() {
  drawStatusBar("TEMP", PAGE_TEMPERATURE);
  char buf[16];

  if (!tempOk || isnan(tempC)) {
    textCentered(64, 28, 1, tempOk ? "reading..." : "TMP117 not found");
    return;
  }

  snprintf(buf, sizeof(buf), "%.1f", tempC);
  textAt(4, 13, 3, buf);
  textAt(78, 13, 2, "C");

  snprintf(buf, sizeof(buf), "%.1f F", tempF);
  textAt(4, 40, 1, buf);

  bool fever = feverNow();
  if (fever) {
    display.fillRect(4, 52, 66, 10, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
    textAt(8, 53, 1, "FEVER WARN");
    display.setTextColor(SSD1306_WHITE);
  } else {
    textAt(4, 53, 1, "NORMAL");
  }

  // Thermometer gauge, 30..42 C.
  int level = (int)(((constrain(tempC, 30.0f, 42.0f) - 30.0f) / 12.0f) * 34.0f);
  display.drawRoundRect(104, 12, 8, 40, 3, SSD1306_WHITE);
  display.fillCircle(108, 55, 6, SSD1306_WHITE);
  display.fillRect(106, 50 - level, 4, level + 2, SSD1306_WHITE);
}

void drawPage_GSR() {
  drawStatusBar("SWEAT", PAGE_GSR);
  char buf[16];

  snprintf(buf, sizeof(buf), "%.1f", gsrMicrosiemens);
  textAt(4, 13, 3, buf);
  textAt(4, 38, 1, "uS conductance");
  drawDrop(112, 26, 8);

  // 16-segment level bar, full scale 20 uS.
  int segs = (int)((constrain(gsrMicrosiemens, 0.0f, 20.0f) / 20.0f) * 16.0f + 0.5f);
  for (int i = 0; i < 16; i++) {
    int x = 4 + i * 7;
    if (i < segs) display.fillRect(x, 47, 5, 6, SSD1306_WHITE);
    else          display.drawRect(x, 47, 5, 6, SSD1306_WHITE);
  }
  const char *label = gsrMicrosiemens > 15.0f ? "HEAVY SWEAT"
                    : gsrMicrosiemens > 5.0f  ? "MODERATE"
                                              : "RESTING";
  textAt(4, 55, 1, label);
}

void drawPage_Accel() {
  drawStatusBar("MOTION", PAGE_ACCEL);
  char buf[16];

  if (!mpuOk) {
    textCentered(64, 28, 1, "MPU-6050 not found");
    return;
  }

  snprintf(buf, sizeof(buf), "%.2f", isnan(accelG) ? 0.0f : accelG);
  textAt(4, 13, 3, buf);
  textAt(4, 38, 1, "g  total accel");

  const char *label = activityEma < 0.06f ? "STILL" : activityEma < 0.25f ? "LIGHT" : "ACTIVE";
  textAt(88, 14, 1, "MOVE");
  textAt(88, 25, 1, label);

  // Rolling |a|-1g history.
  int prevY = -1;
  for (int x = 0; x < ACC_LEN; x++) {
    float v = accBuf[(accIdx + x) % ACC_LEN];
    int px  = x * 2;
    int y   = 62 - (int)(constrain(v * 2.0f, 0.0f, 1.0f) * 14.0f);
    if (prevY >= 0) display.drawLine(px - 2, prevY, px, y, SSD1306_WHITE);
    prevY = y;
  }
  display.drawFastHLine(0, 62, SCREEN_WIDTH, SSD1306_WHITE);
}

void drawPage_Battery() {
  drawStatusBar("BATTERY", PAGE_BATTERY);
  char buf[16];

  // Cell with a segmented fill (5 segments).
  display.drawRoundRect(4, 16, 66, 30, 4, SSD1306_WHITE);
  display.fillRect(70, 26, 4, 10, SSD1306_WHITE);
  int segs = (batteryPct + 10) / 20;                       // 0..5
  for (int i = 0; i < segs; i++) display.fillRect(8 + i * 11, 20, 9, 22, SSD1306_WHITE);

  snprintf(buf, sizeof(buf), "%d", batteryPct);
  textAt(82, 16, 2, buf);
  textAt(82 + (int)strlen(buf) * 12, 23, 1, "%");

  snprintf(buf, sizeof(buf), "%.2fV", batteryVoltage);
  textAt(82, 34, 1, buf);
  const char *state = batteryVoltage >= 4.0f ? "FULL"
                    : batteryVoltage >= 3.6f ? "GOOD"
                    : batteryVoltage >= 3.4f ? "LOW"
                                             : "CRITICAL";
  textAt(82, 43, 1, state);

  textAt(4, 56, 1, "alert below 3.4V");
}


// =============================================================================
//  ALERT OVERLAY & TOAST
// =============================================================================

void drawAlertOverlay() {
  const char *title = "";
  const char *unit  = "";
  char value[12]    = {0};

  switch (activeAlert) {
    case ALERT_FEVER:
      title = "FEVER";
      unit  = "deg C  HIGH";
      snprintf(value, sizeof(value), "%.1f", tempC);
      break;
    case ALERT_HIGH_HR:
      title = "HIGH HEART RATE";
      unit  = "bpm  FAST";
      snprintf(value, sizeof(value), "%d", bpm);
      break;
    case ALERT_LOW_HR:
      title = "LOW HEART RATE";
      unit  = "bpm  SLOW";
      snprintf(value, sizeof(value), "%d", bpm);
      break;
    case ALERT_BATTERY:
      title = "LOW BATTERY";
      unit  = "charge soon";
      snprintf(value, sizeof(value), "%d%%", batteryPct);
      break;
    default:
      return;
  }

  display.clearDisplay();

  // Flashing banner.
  bool flash = (millis() / 450) % 2;
  if (flash) {
    display.fillRect(0, 0, SCREEN_WIDTH, 13, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
  } else {
    display.drawRect(0, 0, SCREEN_WIDTH, 13, SSD1306_WHITE);
    display.setTextColor(SSD1306_WHITE);
  }
  textCentered(64, 3, 1, title);
  display.setTextColor(SSD1306_WHITE);

  // Warning triangle.
  display.drawTriangle(24, 18, 5, 51, 43, 51, SSD1306_WHITE);
  display.drawTriangle(24, 22, 9, 49, 39, 49, SSD1306_WHITE);
  textAt(18, 30, 2, "!");

  textAt(52, 20, 2, value);
  textAt(52, 40, 1, unit);

  display.drawFastHLine(0, 54, SCREEN_WIDTH, SSD1306_WHITE);
  textCentered(64, 56, 1, "press to dismiss");
}

void drawToast() {
  const char *text = toastText;
  if (!text || (long)(toastUntil - millis()) <= 0) return;
  int w = (int)strlen(text) * 6 + 12;
  int x = (SCREEN_WIDTH - w) / 2;
  display.fillRoundRect(x, 50, w, 13, 4, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  textAt(x + 6, 53, 1, text);
  display.setTextColor(SSD1306_WHITE);
}

void updateDisplay() {
  if (!oledOk) return;

  if (wakeRequest) { wakeRequest = false; wakeDisplay(); }
  if (alertVisible()) wakeDisplay();

  if (displayAwake && millis() - lastInteraction > DISPLAY_TIMEOUT_MS) {
    sleepDisplay();
  }
  if (!displayAwake) return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);

  if (alertVisible()) {
    drawAlertOverlay();
  } else {
    switch (currentPage) {
      case PAGE_FACE:        drawFace();             break;
      case PAGE_HEART_RATE:  drawPage_HeartRate();   break;
      case PAGE_TEMPERATURE: drawPage_Temperature(); break;
      case PAGE_GSR:         drawPage_GSR();         break;
      case PAGE_ACCEL:       drawPage_Accel();       break;
      case PAGE_BATTERY:     drawPage_Battery();     break;
      default:               drawFace();             break;
    }
  }

  drawToast();
  display.display();
}


// =============================================================================
//  BLE
// =============================================================================

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *, NimBLEConnInfo &) override {
    Serial.println(F("BLE connected"));
    showToast("App connected");
  }
  void onDisconnect(NimBLEServer *, NimBLEConnInfo &, int) override {
    Serial.println(F("BLE disconnected — advertising again"));
    buzzRemaining = 0;
    ledcWrite(MOTOR_PIN, 0);
    showToast("App disconnected");
    NimBLEDevice::startAdvertising();
  }
};

class VibrationCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &) override {
    NimBLEAttValue v = c->getValue();
    if (v.size() < 1) return;
    buzzRemaining = 0;
    ledcWrite(MOTOR_PIN, v.data()[0]);
  }
};

void notifyFloat(NimBLECharacteristic *c, float value) {
  c->setValue((const uint8_t *)&value, sizeof(value));
  c->notify();
}

// Push the alert the wearer currently sees (0 once dismissed or cleared).
void publishAlert() {
  if (!alertChar) return;
  uint8_t code = alertVisible() ? (uint8_t)activeAlert : (uint8_t)ALERT_NONE;
  alertChar->setValue(&code, 1);
  if (bleServer && bleServer->getConnectedCount() > 0) alertChar->notify();
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
  alertChar = svc->createCharacteristic(CHAR_ALERT_UUID, RN);
  uint8_t none = ALERT_NONE;
  alertChar->setValue(&none, 1);

  uint64_t mac = ESP.getEfuseMac();
  char serial[16];
  snprintf(serial, sizeof(serial), "SWST-%02X%02X%02X",
           (uint8_t)(mac >> 24), (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
  NimBLEService *info = bleServer->createService(NimBLEUUID((uint16_t)0x180A));
  info->createCharacteristic(NimBLEUUID((uint16_t)0x2A29), NIMBLE_PROPERTY::READ)->setValue(BLE_MANUFACTURER);
  info->createCharacteristic(NimBLEUUID((uint16_t)0x2A24), NIMBLE_PROPERTY::READ)->setValue(BLE_MODEL_NUMBER);
  info->createCharacteristic(NimBLEUUID((uint16_t)0x2A25), NIMBLE_PROPERTY::READ)->setValue(serial);

  NimBLEService *batt = bleServer->createService(NimBLEUUID((uint16_t)0x180F));
  batteryChar = batt->createCharacteristic(NimBLEUUID((uint16_t)0x2A19), RN);

  bleServer->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setName(BLE_DEVICE_NAME);
  adv->addServiceUUID(SWEATSALT_SERVICE_UUID);
  adv->enableScanResponse(true);
  adv->start();
}

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
//  BOOT SEQUENCE & SPLASH
// =============================================================================

void showBootSplash(const char *subtext, int progressPct) {
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  drawDrop(64, 17, 7);                                     // sweat drop mark
  textCentered(64, 30, 1, "SWEATSALT");
  textCentered(64, 40, 1, subtext);

  display.drawRoundRect(14, 53, 100, 7, 3, SSD1306_WHITE);
  int fillWidth = (progressPct * 96) / 100;
  if (fillWidth > 0) display.fillRoundRect(16, 55, fillWidth, 3, 1, SSD1306_WHITE);
  display.display();
}

void bootRow(int y, const char *name, bool ok) {
  textAt(6, y, 1, name);
  textAt(84, y, 1, ok ? "OK" : "FAIL");
  if (ok) {                                                // tick mark
    display.drawLine(108, y + 4, 110, y + 6, SSD1306_WHITE);
    display.drawLine(110, y + 6, 114, y + 1, SSD1306_WHITE);
  }
}

void showBootDiagnostics() {
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  textCentered(64, 1, 1, "SS-MVP-1 SELF TEST");
  display.drawFastHLine(0, 11, SCREEN_WIDTH, SSD1306_WHITE);

  bootRow(15, "IMU",  mpuOk);
  bootRow(25, "TEMP", tempOk);
  bootRow(35, "BLE",  true);

  char buf[24];
  snprintf(buf, sizeof(buf), "BATT %d%% %.2fV", batteryPct, batteryVoltage);
  textAt(6, 45, 1, buf);

  display.fillRect(0, 55, SCREEN_WIDTH, 9, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  textCentered(64, 56, 1, "READY");
  display.setTextColor(SSD1306_WHITE);
  display.display();
}


// =============================================================================
//  SETUP
// =============================================================================

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 2000) delay(10);
  Serial.println(F("\n=== SweatSalt firmware — boot ==="));

  pinMode(USER_LED, OUTPUT);
  digitalWrite(USER_LED, LED_OFF);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  analogReadResolution(12);

  Wire.begin();
  Wire.setClock(400000);

  ledcAttach(MOTOR_PIN, PWM_FREQ, PWM_RESOLUTION);
  ledcWrite(MOTOR_PIN, 0);

  oledOk = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (oledOk) {
    showBootSplash("Starting...", 15);
  }

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  mpuOk = (Wire.endTransmission(true) == 0);
  showBootSplash("Sensors...", 40);

  tempOk = tempSensor.begin();
  showBootSplash("Temperature...", 65);

  setupBle();
  showBootSplash("Bluetooth...", 85);

  readBatteryBlocking();                       // so the first notify has a value
  showBootSplash("Ready!", 100);
  delay(300);

  showBootDiagnostics();

  buzzMotor(1, 180, 150);
  flashLed(120);

  delay(1200);
  lastInteraction   = millis();
  lastDisplayUpdate = millis();

  Serial.println(F("=== Boot complete ===\n"));
}


// =============================================================================
//  MAIN LOOP
// =============================================================================

void loop() {
  unsigned long now = millis();

  handleButton();
  updateBuzz();
  updateLed();

  if (now - lastPulseSample >= PULSE_SAMPLE_MS) { lastPulseSample = now; updatePulse(); }
  if (now - lastGsrSample   >= GSR_SAMPLE_MS)   { lastGsrSample   = now; readGSR(); }
  updateBattery(now);
  if (now - lastTempSample  >= TEMP_SAMPLE_MS)  { lastTempSample  = now; readTemperature(); }
  if (mpuOk && now - lastAccelSample >= ACCEL_SAMPLE_MS) { lastAccelSample = now; readMPU6050(); }
  if (now - lastAlertCheck  >= ALERT_CHECK_MS)  { lastAlertCheck  = now; checkAlerts(); }
  if (now - lastDisplayUpdate >= DISPLAY_MS)    { lastDisplayUpdate = now; updateDisplay(); }
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
