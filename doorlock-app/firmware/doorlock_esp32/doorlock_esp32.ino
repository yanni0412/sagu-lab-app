/*
  도어온 BLE 도어락 펌웨어 (ESP32, Arduino)

  - 앱의 BleLockDriver 와 같은 프로토콜을 씁니다 (doorlock/index.html 의 "BLE: 도어온 프로토콜" 주석 참고)
  - 모든 열기/잠그기 명령은 일회용 난수(nonce) + HMAC-SHA256 으로 인증 → 키 없이는 열 수 없고, 엿들은 명령을 다시 보내도 안 열림
  - 보안 키는 처음 켤 때 무작위로 만들어 NVS에 저장하고 시리얼(115200)에 출력합니다
  - BOOT 버튼을 5초 누르면 키를 새로 만듭니다 (기존 앱 등록은 무효가 됨)

  보드: ESP32 Dev Module (arduino-esp32 2.x / 3.x, 추가 라이브러리 필요 없음)
*/
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <Preferences.h>
#include "mbedtls/md.h"
#if __has_include(<esp_random.h>)
#include <esp_random.h>   // esp_fill_random (arduino-esp32 3.x)
#endif

// ───── 하드웨어 설정 (내 회로에 맞게 수정) ─────
const int  PIN_LATCH       = 26;    // 잠금장치 구동 (릴레이/모터드라이버). 아래 applyLatch() 참고
const int  PIN_DOOR        = 27;    // 문 리드스위치: 문 닫힘 = LOW (INPUT_PULLUP)
const int  PIN_INSIDE      = 14;    // 실내 열림 버튼: 누름 = LOW (INPUT_PULLUP)
const int  PIN_RESET_KEY   = 0;     // BOOT 버튼
const bool HAS_DOOR_SENSOR = true;  // 리드스위치가 없으면 false
const int  PIN_BATTERY_ADC = -1;    // 배터리 분압 ADC 핀 (-1 = 없음, 100%로 보고)
const uint32_t DOOR_ALERT_MS = 60000;   // 문이 이만큼 열려 있으면 경고

#define SVC_UUID "d00a0001-7c3e-4b9a-9f1e-3a5c2b8e6f10"
#define CMD_UUID "d00a0002-7c3e-4b9a-9f1e-3a5c2b8e6f10"
#define EVT_UUID "d00a0003-7c3e-4b9a-9f1e-3a5c2b8e6f10"

enum { R_OK = 0, R_BADMAC = 1, R_DOUBLE = 2, R_NONCE = 3, R_DOOROPEN = 4, R_BADCMD = 5, R_LOCKOUT = 6 };
enum { M_KEYPAD = 1, M_INSIDE = 2, M_AUTO = 3, M_APP = 4 };

Preferences prefs;
BLECharacteristic* evtChar = nullptr;
bool clientConnected = false;

uint8_t key[16];
uint8_t nonce[8];
bool nonceValid = false;
uint32_t nonceAt = 0;
uint8_t failCount = 0;
uint32_t lockoutUntil = 0;

bool locked = true;
bool doorOpen = false;
uint8_t autoLockSec = 5;
uint32_t unlockedAt = 0, doorChangedAt = 0;
bool doorAlertSent = false;

// BLE 콜백(별도 태스크)에서 받은 명령을 loop()에서 처리하기 위한 버퍼
portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool rxPending = false;
uint8_t rxBuf[20];
size_t rxLen = 0;

// ───── 유틸 ─────
void printKey() {
  Serial.print("[도어온] 보안 키: ");
  for (int i = 0; i < 16; i++) Serial.printf("%02x", key[i]);
  Serial.println("   ← 앱의 '블루투스 도어락 등록'에 입력");
}

void loadOrCreateKey(bool forceNew) {
  prefs.begin("dooron", false);
  if (forceNew || prefs.getBytesLength("key") != 16) {
    esp_fill_random(key, 16);
    prefs.putBytes("key", key, 16);
    Serial.println("[도어온] 새 보안 키를 만들었어요");
  } else {
    prefs.getBytes("key", key, 16);
  }
  autoLockSec = prefs.getUChar("auto", 5);
  prefs.end();
}

void hmac16(const uint8_t* msg, size_t len, uint8_t out[16]) {
  uint8_t full[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), key, 16, msg, len, full);
  memcpy(out, full, 16);
}

bool equal16(const uint8_t* a, const uint8_t* b) {   // 시간차 공격 방지용 상수시간 비교
  uint8_t d = 0;
  for (int i = 0; i < 16; i++) d |= a[i] ^ b[i];
  return d == 0;
}

uint8_t batteryPercent() {
  if (PIN_BATTERY_ADC < 0) return 100;
  // 예: 4xAA(6.0V→4.4V)를 1/2 분압해 ADC에 연결했다고 가정. 회로에 맞게 수정하세요.
  float v = analogReadMilliVolts(PIN_BATTERY_ADC) * 2 / 1000.0;
  int p = (int)((v - 4.4) / (6.0 - 4.4) * 100);
  return (uint8_t)constrain(p, 0, 100);
}

void notify(const uint8_t* data, size_t len) {
  if (!clientConnected || !evtChar) return;
  evtChar->setValue((uint8_t*)data, len);
  evtChar->notify();
}

void sendState() {
  uint8_t s[5] = {0xA0, (uint8_t)locked, (uint8_t)doorOpen, batteryPercent(), autoLockSec};
  notify(s, 5);
}

void sendEvent(uint8_t kind, uint8_t detail) {
  uint8_t e[3] = {0xB0, kind, detail};
  notify(e, 3);
}

// 실제 잠금장치 구동. 모터식 도어락이면 여기서 정/역회전 펄스를, 서보면 각도를 주세요.
void applyLatch() {
  digitalWrite(PIN_LATCH, locked ? LOW : HIGH);
}

void setLocked(bool l, uint8_t method, bool fromApp) {
  if (locked == l) return;
  locked = l;
  applyLatch();
  if (!l) unlockedAt = millis();
  Serial.printf("[도어온] %s (방법 %d)\n", l ? "잠김" : "열림", method);
  if (!fromApp) sendEvent(l ? 2 : 1, method);   // 앱이 보낸 명령은 앱이 직접 기록
  sendState();
}

// ───── 명령 처리 ─────
void result(uint8_t op, uint8_t code) {
  uint8_t r[3] = {0x90, op, code};
  notify(r, 3);
}

void handleCommand(const uint8_t* b, size_t n) {
  if (n == 1 && b[0] == 0x01) {                       // 난수 요청
    esp_fill_random(nonce, 8);
    nonceValid = true;
    nonceAt = millis();
    uint8_t out[9] = {0x81};
    memcpy(out + 1, nonce, 8);
    notify(out, 9);
    return;
  }
  if (n == 1 && b[0] == 0x02) { sendState(); return; }
  if (n != 18) { result(n ? b[0] : 0, R_BADCMD); return; }

  uint8_t op = b[0], arg = b[1];
  if (millis() < lockoutUntil) { result(op, R_LOCKOUT); return; }
  if (!nonceValid || millis() - nonceAt > 10000) { nonceValid = false; result(op, R_NONCE); return; }

  uint8_t msg[10], mac[16];
  memcpy(msg, nonce, 8);
  msg[8] = op; msg[9] = arg;
  nonceValid = false;                                 // 성공·실패와 관계없이 한 번 쓰면 폐기
  hmac16(msg, 10, mac);
  if (!equal16(mac, b + 2)) {
    result(op, R_BADMAC);
    if (++failCount >= 5) {
      failCount = 0;
      lockoutUntil = millis() + 30000;
      sendEvent(3, 2);                                // 경고: 인증 실패 반복
      Serial.println("[도어온] 인증 실패 5회 — 30초 차단");
    }
    return;
  }
  failCount = 0;

  switch (op) {
    case 0x00: result(op, R_OK); sendState(); break;   // 키 확인
    case 0x10: result(op, R_OK); setLocked(false, M_APP, true); break;
    case 0x11:
      if (HAS_DOOR_SENSOR && doorOpen) { result(op, R_DOOROPEN); break; }
      result(op, R_OK); setLocked(true, M_APP, true); break;
    case 0x20:
      autoLockSec = arg;
      prefs.begin("dooron", false); prefs.putUChar("auto", autoLockSec); prefs.end();
      result(op, R_OK); sendState(); break;
    default: result(op, R_BADCMD);
  }
}

// ───── BLE ─────
class ServerCb : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { clientConnected = true; }
  void onDisconnect(BLEServer* s) override {
    clientConnected = false;
    nonceValid = false;
    s->startAdvertising();
  }
};

class CmdCb : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    auto v = c->getValue();                           // 2.x: std::string, 3.x: String — 둘 다 length()/c_str() 지원
    size_t n = v.length();
    if (n > sizeof(rxBuf)) n = sizeof(rxBuf);
    portENTER_CRITICAL(&rxMux);
    memcpy(rxBuf, v.c_str(), n);
    rxLen = n;
    rxPending = true;
    portEXIT_CRITICAL(&rxMux);
  }
};

void setupBle() {
  BLEDevice::init("DoorOn Lock");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCb());
  BLEService* svc = server->createService(SVC_UUID);
  BLECharacteristic* cmd = svc->createCharacteristic(CMD_UUID, BLECharacteristic::PROPERTY_WRITE);
  cmd->setCallbacks(new CmdCb());
  evtChar = svc->createCharacteristic(EVT_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  evtChar->addDescriptor(new BLE2902());
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

// ───── 메인 ─────
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LATCH, OUTPUT);
  pinMode(PIN_DOOR, INPUT_PULLUP);
  pinMode(PIN_INSIDE, INPUT_PULLUP);
  pinMode(PIN_RESET_KEY, INPUT_PULLUP);
  loadOrCreateKey(false);
  printKey();
  applyLatch();
  doorOpen = HAS_DOOR_SENSOR && digitalRead(PIN_DOOR) == HIGH;
  setupBle();
  Serial.println("[도어온] 블루투스 광고 시작 — 앱에서 '도어락 추가'를 누르세요");
}

void loop() {
  uint32_t now = millis();

  // 1) 앱 명령
  if (rxPending) {
    uint8_t b[20]; size_t n;
    portENTER_CRITICAL(&rxMux);
    n = rxLen; memcpy(b, rxBuf, n); rxPending = false;
    portEXIT_CRITICAL(&rxMux);
    handleCommand(b, n);
  }

  // 2) 문 센서 (50ms 디바운스)
  static uint32_t doorDeb = 0; static bool doorRaw = doorOpen;
  if (HAS_DOOR_SENSOR) {
    bool raw = digitalRead(PIN_DOOR) == HIGH;
    if (raw != doorRaw) { doorRaw = raw; doorDeb = now; }
    if (raw != doorOpen && now - doorDeb > 50) {
      doorOpen = raw; doorChangedAt = now; doorAlertSent = false;
      sendState();
    }
    if (doorOpen && !doorAlertSent && now - doorChangedAt > DOOR_ALERT_MS) {
      doorAlertSent = true;
      sendEvent(3, 1);                                // 경고: 문 열림 지속
    }
  }

  // 3) 실내 버튼: 잠김이면 열고, 열림이면 잠금
  static bool btnPrev = true; static uint32_t btnAt = 0;
  bool btn = digitalRead(PIN_INSIDE) == HIGH;
  if (btn != btnPrev && now - btnAt > 50) {
    btnAt = now; btnPrev = btn;
    if (!btn) {
      if (locked) setLocked(false, M_INSIDE, false);
      else if (!(HAS_DOOR_SENSOR && doorOpen)) setLocked(true, M_INSIDE, false);
    }
  }

  // 4) 자동 잠금: 열린 뒤(또는 문이 닫힌 뒤) autoLockSec 초가 지나고 문이 닫혀 있으면 잠금
  if (!locked && autoLockSec > 0 && !(HAS_DOOR_SENSOR && doorOpen)) {
    uint32_t since = max(unlockedAt, doorChangedAt);
    if (now - since > (uint32_t)autoLockSec * 1000) setLocked(true, M_AUTO, false);
  }

  // 5) BOOT 5초 → 보안 키 재생성
  static uint32_t resetAt = 0;
  if (digitalRead(PIN_RESET_KEY) == LOW) {
    if (!resetAt) resetAt = now;
    if (now - resetAt > 5000) { loadOrCreateKey(true); printKey(); delay(500); ESP.restart(); }
  } else resetAt = 0;

  delay(5);
}
