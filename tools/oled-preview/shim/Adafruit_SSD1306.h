// Framebuffer-only SSD1306 with the same drawing semantics as the real one
// (WHITE / BLACK / INVERSE on a 1bpp page buffer).
#pragma once
#include <Adafruit_GFX.h>
#include "Wire.h"
#define SSD1306_BLACK 0
#define SSD1306_WHITE 1
#define SSD1306_INVERSE 2
#define SSD1306_SWITCHCAPVCC 0x02
#define SSD1306_DISPLAYOFF 0xAE
#define SSD1306_DISPLAYON 0xAF
class Adafruit_SSD1306 : public Adafruit_GFX {
public:
  uint8_t fb[128 * 64] = {0};  // one byte per pixel, simple
  bool on = true;
  Adafruit_SSD1306(uint8_t w, uint8_t h, TwoWire *, int8_t) : Adafruit_GFX(w, h) {}
  bool begin(uint8_t, uint8_t) { return true; }
  void ssd1306_command(uint8_t c) { on = (c == SSD1306_DISPLAYON); }
  void clearDisplay() { memset(fb, 0, sizeof fb); }
  void display() {}
  void drawPixel(int16_t x, int16_t y, uint16_t color) override {
    if (x < 0 || y < 0 || x >= 128 || y >= 64) return;
    uint8_t &p = fb[y * 128 + x];
    if (color == SSD1306_WHITE) p = 1;
    else if (color == SSD1306_BLACK) p = 0;
    else p ^= 1;
  }
};
