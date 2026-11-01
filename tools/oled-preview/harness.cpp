// Desktop harness: compiles the REAL display code from firmware/firmware.ino
// (extracted by preview.py into slice_*.inc) against a framebuffer SSD1306,
// poses it in each screen state and dumps frames as text.
#include <Arduino.h>
#include <Adafruit_SSD1306.h>
#include <cstring>

unsigned long g_millis = 0;
SerialStub Serial;
TwoWire Wire;

#define D3 3
#define D6 6
#define D10 10
#define MOTOR_PIN D6
#define BUTTON_PIN D3
#define USER_LED D10
inline int digitalRead(int) { return 1; }
inline void digitalWrite(int, int) {}
inline void ledcWrite(int, int) {}

// --- state the firmware keeps in sections we don't extract ----------------
struct FakeServer { int n = 0; int getConnectedCount() { return n; } } fakeServer;
FakeServer *bleServer = &fakeServer;
bool  mpuOk = true, tempOk = true, bpmValid = true;
float accelG = 1.0f, tempC = 36.5f, tempF = 97.7f;
int   bpm = 72;
unsigned long lastBeatTime = 0;
float gsrMicrosiemens = 4.2f, batteryVoltage = 3.95f;
uint8_t batteryPct = 72;
volatile int buzzRemaining = 0;
void buzzMotor(int, int = 200, int = 150, int = 100) {}

#include "slice_a.inc"   // AlertType enum + OLED display object
#include "slice_b.inc"   // history buffers / LED
#include "slice_c.inc"   // alerts, button, drawing, pages, updateDisplay
void publishAlert() {}
#include "slice_d.inc"   // boot splash + self-test

static void dump(const char *name) {
  printf("FRAME %s\n", name);
  for (int y = 0; y < 64; y++) {
    for (int x = 0; x < 128; x++) putchar(display.fb[y * 128 + x] ? '1' : '0');
    putchar('\n');
  }
}

static void reset() {
  g_millis = 100000;
  oledOk = true;
  lastInteraction = g_millis;
  displayAwake = true;
  toastText = nullptr;
  activeAlert = ALERT_NONE;
  alertDismissed = false;
  bpmValid = true; bpm = 72; tempC = 36.5f; tempF = 97.7f; gsrMicrosiemens = 4.2f;
  batteryPct = 72; batteryVoltage = 3.95f; activityEma = 0.03f; accelG = 1.02f;
  lastBeatTime = 0;
  fakeServer.n = 1;
  // pulse-like waveform: quick systolic spike + dicrotic notch
  for (int i = 0; i < WAVE_LEN; i++) {
    float ph = fmodf(i / 36.0f, 1.0f);
    float v = 14 + 40 * expf(-powf((ph - 0.15f) * 14, 2)) + 12 * expf(-powf((ph - 0.42f) * 12, 2));
    waveBuf[i] = (uint8_t)constrain(v, 0, 63);
  }
  waveIdx = 0;
  for (int i = 0; i < ACC_LEN; i++) accBuf[i] = 0.05f + 0.25f * fabsf(sinf(i * 0.35f)) * (i > 30 ? 1.8f : 0.4f);
  accIdx = 0;
}

static void scene(const char *name, DisplayPage page) {
  currentPage = page;
  lastBeatTime = 0;
  updateDisplay();
  dump(name);
}

int main() {
  reset(); scene("home", PAGE_FACE);
  reset(); lastBeatTime = 100000 - 60; currentPage = PAGE_FACE; updateDisplay(); dump("home_beat");
  reset(); bpmValid = false; activityEma = 0.4f; tempOk = true; scene("home_nosignal", PAGE_FACE);
  reset(); lastBeatTime = 100000 - 60; currentPage = PAGE_HEART_RATE; updateDisplay(); dump("heart");
  reset(); bpmValid = false; scene("heart_nofinger", PAGE_HEART_RATE);
  reset(); scene("temp", PAGE_TEMPERATURE);
  reset(); tempC = 38.4f; tempF = 101.1f; scene("temp_fever", PAGE_TEMPERATURE);
  reset(); gsrMicrosiemens = 16.8f; scene("sweat_heavy", PAGE_GSR);
  reset(); gsrMicrosiemens = 2.1f; scene("sweat_rest", PAGE_GSR);
  reset(); activityEma = 0.4f; accelG = 1.31f; scene("motion", PAGE_ACCEL);
  reset(); scene("battery", PAGE_BATTERY);
  reset(); batteryPct = 12; batteryVoltage = 3.42f; scene("battery_low", PAGE_BATTERY);
  reset(); tempC = 38.4f; activeAlert = ALERT_FEVER; g_millis = 100000; scene("alert_fever_a", PAGE_FACE);
  reset(); tempC = 38.4f; activeAlert = ALERT_FEVER; g_millis = 100000 + 460; lastInteraction = g_millis; scene("alert_fever_b", PAGE_FACE);
  reset(); bpm = 134; activeAlert = ALERT_HIGH_HR; scene("alert_highhr", PAGE_FACE);
  reset(); bpm = 44; activeAlert = ALERT_LOW_HR; scene("alert_lowhr", PAGE_FACE);
  reset(); batteryPct = 9; activeAlert = ALERT_BATTERY; scene("alert_battery", PAGE_FACE);
  reset(); showToast("Alert dismissed"); scene("toast", PAGE_FACE);
  reset(); showBootSplash("Sensors...", 40); dump("boot_splash");
  reset(); mpuOk = true; tempOk = false; showBootDiagnostics(); dump("boot_selftest");
  return 0;
}
