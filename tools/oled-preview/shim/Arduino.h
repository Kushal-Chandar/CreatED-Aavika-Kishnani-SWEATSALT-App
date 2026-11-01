// Minimal Arduino surface so the real firmware drawing code (and the real
// Adafruit_GFX) compile on a desktop. Only what the preview needs.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include "Print.h"
#define F(x) (x)
#define PROGMEM
#define HIGH 1
#define LOW 0
#define constrain(a, lo, hi) ((a) < (lo) ? (lo) : ((a) > (hi) ? (hi) : (a)))
#ifndef min
#define min(a, b) ((a) < (b) ? (a) : (b))
#define max(a, b) ((a) > (b) ? (a) : (b))
#endif
#ifndef _swap_int16_t
#define _swap_int16_t(a, b) { int16_t t = a; a = b; b = t; }
#endif
using std::isnan;
using std::fabsf;
typedef bool boolean;
class String { public: size_t length() const { return 0; } const char *c_str() const { return ""; } };
#define radians(deg) ((deg) * 0.017453292519943295)
extern unsigned long g_millis;
inline unsigned long millis() { return g_millis; }
inline void delay(unsigned long) {}
struct SerialStub {
  template <class T> void print(T) {}
  template <class T, class U> void print(T, U) {}
  template <class T> void println(T) {}
  template <class T, class U> void println(T, U) {}
  void println() {}
};
extern SerialStub Serial;
