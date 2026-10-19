/*
  카온(CarOn) 차량 원격제어 펌웨어 — ESP32 + 릴레이

  - 앱(caron/index.html)의 "카온 BLE 프로토콜"과 짝을 이룹니다.
  - 모든 명령은 일회용 난수(nonce) + HMAC-SHA256 으로 인증 → 키 없이 조작 불가, 엿들은 신호 재전송 불가.
  - 보안 키는 처음 켤 때 무작위 생성 → NVS 저장 → 시리얼(115200) 출력. BOOT 버튼 5초 = 키 재생성.
  - 앱의 "기기 비밀번호 변경"은 새 키를 기존 키로 암호화해 전달하고, 새 키로 확인 명령이 와야 확정합니다.

  ⚠️ 차량 배선 주의
  - 가장 안전한 방법: 차량에 이미 달린 리모컨(원격시동기/경보기)의 버튼 접점에 릴레이(또는 포토커플러)를
    병렬로 연결해 "버튼을 대신 눌러 주는" 방식. 이 경우 PULSE_* 시간만 맞추면 됩니다.
  - 점화(IGN)·스타터(STARTER)를 직접 제어하는 것은 차종별 이모빌라이저·안전회로 때문에 위험합니다.
    반드시 전문 설치점 또는 상용 원격시동 모듈을 통해 연결하세요.

  보드: ESP32 Dev Module (arduino-esp32 2.x / 3.x, 추가 라이브러리 없음)
*/
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <Preferences.h>
#include "mbedtls/md.h"
#if __has_include(<esp_random.h>)
#include <esp_random.h>   // esp_fill_random (arduino-esp32 3.x)
#endif

// ───── 출력 (릴레이) ─────
const int PIN_LOCK    = 25;   // 잠금 펄스
const int PIN_UNLOCK  = 26;   // 열림 펄스
const int PIN_TRUNK   = 27;   // 트렁크 펄스
const int PIN_HORN    = 33;   // 경적/비상등 펄스
const int PIN_IGN     = 32;   // 점화(ACC/IGN) 유지
const int PIN_STARTER = 13;   // 스타터 크랭킹 펄스
const int RELAY_ON    = HIGH; // 릴레이 모듈이 LOW 트리거면 LOW 로

const uint16_t PULSE_LOCK_MS  = 500;
const uint16_t PULSE_TRUNK_MS = 800;
const uint16_t IGN_PRIME_MS   = 2000;   // 점화 후 연료펌프 대기
const uint16_t CRANK_MS       = 1200;   // 크랭킹 시간 (차종에 맞게)

// ───── 입력 (없으면 HAS_* = false) ─────
const bool HAS_HOOD  = true;  const int PIN_HOOD  = 19;   // 보닛 스위치: 열림 = LOW
const bool HAS_BRAKE = true;  const int PIN_BRAKE = 18;   // 브레이크 (포토커플러): 밟음 = LOW
const bool HAS_DOOR  = true;  const int PIN_DOOR  = 5;    // 도어 실내등 선: 열림 = LOW
const bool HAS_SHOCK = false; const int PIN_SHOCK = 17;   // 충격 센서: 감지 = LOW
const int  PIN_VBAT  = 34;    // 차량 배터리 분압 ADC (-1 = 없음)
const float VBAT_DIVIDER = 5.7;   // 예: 47k / 10k 분압
const int  PIN_RESET_KEY = 0;     // BOOT

#define SVC_UUID "ca700001-5e1f-4b2a-8c3d-7a9e0b1c2d30"
#define CMD_UUID "ca700002-5e1f-4b2a-8c3d-7a9e0b1c2d30"
#define EVT_UUID "ca700003-5e1f-4b2a-8c3d-7a9e0b1c2d30"

enum { RES_OK = 0, RES_BADMAC = 1, RES_NONCE = 3, RES_BADCMD = 5, RES_LOCKOUT = 6,
       RES_HOOD = 7, RES_BRAKE = 8, RES_RUNNING = 9 };
// 이벤트 종류 / 사유
enum { EV_UNLOCK = 1, EV_LOCK = 2, EV_ALARM = 3, EV_START = 4, EV_STOP = 5, EV_TRUNK = 6 };
enum { BY_AUTO_RELOCK = 3, BY_WALKAWAY = 6 };
enum { STOP_TIMEOUT = 1, STOP_BRAKE = 3 };
enum { ALARM_INTRUSION = 1, ALARM_BADKEY = 2 };

Preferences prefs;
BLECharacteristic* evtChar = nullptr;
volatile bool clientConnected = false;
volatile uint32_t disconnectedAt = 0;

uint8_t key[16], pendingKey[16];
bool pendingValid = false;
uint32_t pendingAt = 0;
uint8_t nonce[8];
bool nonceValid = false;
uint32_t nonceAt = 0;
uint8_t failCount = 0;
uint32_t lockoutUntil = 0;

bool locked = true, engine = false, trunkFlag = false;
uint8_t runMin = 10;
bool walkAway = true;
uint32_t engineUntil = 0, unlockedAt = 0, trunkAt = 0;
bool relockArmed = false, walkAwayArmed = false;

portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool rxPending = false;
uint8_t rxBuf[20];
size_t rxLen = 0;

// ───── 유틸 ─────
void printKey() {
  Serial.print("[카온] 보안 키: ");
  for (int i = 0; i < 16; i++) Serial.printf("%02x", key[i]);
  Serial.println("   ← 앱 설정 > 기기 검색에 입력");
}

void loadSettings(bool newKey) {
  prefs.begin("caron", false);
  if (newKey || prefs.getBytesLength("key") != 16) {
    esp_fill_random(key, 16);
    prefs.putBytes("key", key, 16);
    Serial.println("[카온] 새 보안 키를 만들었어요");
  } else {
    prefs.getBytes("key", key, 16);
  }
  runMin = prefs.getUChar("run", 10);
  walkAway = prefs.getBool("walk", true);
  prefs.end();
}

void saveKey(const uint8_t* k) {
  memcpy(key, k, 16);
  prefs.begin("caron", false); prefs.putBytes("key", key, 16); prefs.end();
}

void hmacWith(const uint8_t* k, const uint8_t* msg, size_t len, uint8_t* out, size_t outLen) {
  uint8_t full[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), k, 16, msg, len, full);
  memcpy(out, full, outLen);
}

bool equal16(const uint8_t* a, const uint8_t* b) {   // 상수시간 비교
  uint8_t d = 0;
  for (int i = 0; i < 16; i++) d |= a[i] ^ b[i];
  return d == 0;
}

bool readActiveLow(bool has, int pin) { return has && digitalRead(pin) == LOW; }
bool hoodOpen()  { return readActiveLow(HAS_HOOD, PIN_HOOD); }
bool brakeOn()   { return readActiveLow(HAS_BRAKE, PIN_BRAKE); }
bool doorOpen()  { return readActiveLow(HAS_DOOR, PIN_DOOR); }

uint8_t voltageDv() {
  if (PIN_VBAT < 0) return 0;
  float v = analogReadMilliVolts(PIN_VBAT) / 1000.0 * VBAT_DIVIDER;
  return (uint8_t)constrain((int)(v * 10 + 0.5), 0, 255);
}

void notify(const uint8_t* data, size_t len) {
  if (!clientConnected || !evtChar) return;
  evtChar->setValue((uint8_t*)data, len);
  evtChar->notify();
  delay(8);   // 연속 알림 사이 여유
}

void sendState() {
  uint8_t minsLeft = 0;
  if (engine) minsLeft = (uint8_t)((engineUntil - millis() + 59999UL) / 60000UL);
  uint8_t s[8] = {0xA0, (uint8_t)locked, (uint8_t)engine, (uint8_t)trunkFlag, minsLeft, voltageDv(), (uint8_t)walkAway, runMin};
  notify(s, 8);
}

void sendEvent(uint8_t kind, uint8_t detail) {
  uint8_t e[3] = {0xB0, kind, detail};
  notify(e, 3);
}

void result(uint8_t op, uint8_t code) {
  uint8_t r[3] = {0x90, op, code};
  notify(r, 3);
}

void pulse(int pin, uint16_t ms) {
  digitalWrite(pin, RELAY_ON); delay(ms); digitalWrite(pin, !RELAY_ON);
}

void honk(int times, uint16_t onMs, uint16_t offMs) {
  for (int i = 0; i < times; i++) { pulse(PIN_HORN, onMs); if (i + 1 < times) delay(offMs); }
}

// ───── 동작 ─────
void doLock(uint8_t by, bool fromApp) {
  pulse(PIN_LOCK, PULSE_LOCK_MS);
  locked = true; relockArmed = false; walkAwayArmed = false;
  honk(1, 40, 0);
  if (!fromApp) sendEvent(EV_LOCK, by);
  sendState();
}

void doUnlock() {
  pulse(PIN_UNLOCK, PULSE_LOCK_MS);
  locked = false; unlockedAt = millis(); relockArmed = true;   // 30초 안에 문을 안 열면 다시 잠금
  honk(2, 40, 120);
  sendState();
}

void engineOff(uint8_t why, bool fromApp) {
  digitalWrite(PIN_STARTER, !RELAY_ON);
  digitalWrite(PIN_IGN, !RELAY_ON);
  engine = false;
  Serial.printf("[카온] 시동 끔 (사유 %d)\n", why);
  if (!fromApp) sendEvent(EV_STOP, why);
  sendState();
}

uint8_t engineStart() {
  if (engine) return RES_RUNNING;
  if (hoodOpen()) return RES_HOOD;
  if (brakeOn()) return RES_BRAKE;
  digitalWrite(PIN_IGN, RELAY_ON);
  delay(IGN_PRIME_MS);
  if (brakeOn() || hoodOpen()) { digitalWrite(PIN_IGN, !RELAY_ON); return RES_BRAKE; }
  pulse(PIN_STARTER, CRANK_MS);
  engine = true;
  engineUntil = millis() + (uint32_t)runMin * 60000UL;
  Serial.printf("[카온] 원격 시동 (%d분)\n", runMin);
  return RES_OK;
}

// ───── 명령 처리 ─────
void handleCommand(const uint8_t* b, size_t n) {
  if (n == 1 && b[0] == 0x01) {
    esp_fill_random(nonce, 8);
    nonceValid = true; nonceAt = millis();
    uint8_t out[9] = {0x81};
    memcpy(out + 1, nonce, 8);
    notify(out, 9);
    return;
  }
  if (n == 1 && b[0] == 0x02) { sendState(); return; }
  if (n != 18) { result(n ? b[0] : 0, RES_BADCMD); return; }

  uint8_t op = b[0], arg = b[1];
  if (millis() < lockoutUntil) { result(op, RES_LOCKOUT); return; }
  if (!nonceValid || millis() - nonceAt > 10000) { nonceValid = false; result(op, RES_NONCE); return; }

  uint8_t usedNonce[8];
  memcpy(usedNonce, nonce, 8);
  nonceValid = false;                                   // 한 번 쓰면 폐기

  uint8_t msg[10], mac[16];
  memcpy(msg, usedNonce, 8); msg[8] = op; msg[9] = arg;
  hmacWith(key, msg, 10, mac, 16);
  bool ok = equal16(mac, b + 2);
  if (!ok && op == 0x00 && pendingValid && millis() - pendingAt < 60000) {   // 새 키 확정 확인
    hmacWith(pendingKey, msg, 10, mac, 16);
    if (equal16(mac, b + 2)) { saveKey(pendingKey); pendingValid = false; ok = true; Serial.println("[카온] 새 보안 키 확정"); printKey(); }
  }
  if (!ok) {
    result(op, RES_BADMAC);
    if (++failCount >= 5) {
      failCount = 0; lockoutUntil = millis() + 30000;
      sendEvent(EV_ALARM, ALARM_BADKEY);
    }
    return;
  }
  failCount = 0;

  switch (op) {
    case 0x00: result(op, RES_OK); sendState(); break;
    case 0x10: result(op, RES_OK); doUnlock(); break;
    case 0x11: result(op, RES_OK); doLock(0, true); break;
    case 0x12: result(op, RES_OK); pulse(PIN_TRUNK, PULSE_TRUNK_MS); trunkFlag = true; trunkAt = millis(); sendState(); break;
    case 0x13: result(op, RES_OK); honk(6, 250, 250); break;
    case 0x14: { uint8_t r = engineStart(); result(op, r); sendState(); break; }
    case 0x15: result(op, RES_OK); if (engine) engineOff(0, true); else sendState(); break;
    case 0x21:
      runMin = constrain(arg, 1, 30);
      prefs.begin("caron", false); prefs.putUChar("run", runMin); prefs.end();
      result(op, RES_OK); sendState(); break;
    case 0x22:
      walkAway = arg != 0;
      prefs.begin("caron", false); prefs.putBool("walk", walkAway); prefs.end();
      result(op, RES_OK); sendState(); break;
    case 0x30: {                                          // 보안 키 재발급
      esp_fill_random(pendingKey, 16);
      pendingValid = true; pendingAt = millis();
      result(op, RES_OK);
      for (uint8_t idx = 0; idx < 2; idx++) {
        uint8_t m[10], pad[8], out[10] = {0xC0, idx};
        memcpy(m, usedNonce, 8); m[8] = 0x30; m[9] = idx;
        hmacWith(key, m, 10, pad, 8);
        for (int i = 0; i < 8; i++) out[2 + i] = pendingKey[idx * 8 + i] ^ pad[i];
        notify(out, 10);
      }
      break;
    }
    default: result(op, RES_BADCMD);
  }
}

// ───── BLE ─────
class ServerCb : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { clientConnected = true; walkAwayArmed = false; }
  void onDisconnect(BLEServer* s) override {
    clientConnected = false; nonceValid = false;
    disconnectedAt = millis(); walkAwayArmed = true;
    s->startAdvertising();
  }
};

class CmdCb : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    auto v = c->getValue();                              // 2.x: std::string, 3.x: String
    size_t n = v.length();
    if (n > sizeof(rxBuf)) n = sizeof(rxBuf);
    portENTER_CRITICAL(&rxMux);
    memcpy(rxBuf, v.c_str(), n); rxLen = n; rxPending = true;
    portEXIT_CRITICAL(&rxMux);
  }
};

void setupBle() {
  BLEDevice::init("CarOn");
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
  for (int p : {PIN_LOCK, PIN_UNLOCK, PIN_TRUNK, PIN_HORN, PIN_IGN, PIN_STARTER}) { pinMode(p, OUTPUT); digitalWrite(p, !RELAY_ON); }
  for (int p : {PIN_HOOD, PIN_BRAKE, PIN_DOOR, PIN_SHOCK, PIN_RESET_KEY}) pinMode(p, INPUT_PULLUP);
  loadSettings(false);
  printKey();
  setupBle();
  Serial.println("[카온] 블루투스 광고 시작 — 앱 설정 > 기기 검색");
}

void loop() {
  uint32_t now = millis();

  if (rxPending) {
    uint8_t b[20]; size_t n;
    portENTER_CRITICAL(&rxMux);
    n = rxLen; memcpy(b, rxBuf, n); rxPending = false;
    portEXIT_CRITICAL(&rxMux);
    handleCommand(b, n);
  }

  // 문 열림 / 경보
  static bool doorPrev = false;
  bool door = doorOpen();
  if (door != doorPrev) {
    doorPrev = door;
    if (door) {
      relockArmed = false;                               // 문을 열었으면 자동 재잠금 취소
      if (locked && !engine) { sendEvent(EV_ALARM, ALARM_INTRUSION); honk(10, 300, 300); }
    }
  }
  static uint32_t shockAt = 0;
  if (readActiveLow(HAS_SHOCK, PIN_SHOCK) && locked && now - shockAt > 5000) {
    shockAt = now; sendEvent(EV_ALARM, ALARM_INTRUSION); honk(3, 200, 200);
  }

  // 자동 재잠금 (열고 30초 동안 문을 안 열면)
  if (relockArmed && !locked && now - unlockedAt > 30000) doLock(BY_AUTO_RELOCK, false);

  // 멀어지면 잠금 (연결 끊기고 10초)
  if (walkAwayArmed && walkAway && !clientConnected && !locked && !engine && now - disconnectedAt > 10000) doLock(BY_WALKAWAY, false);

  // 원격 시동: 시간 종료 / 브레이크(키 없이 운전 시도) 시 끄기
  if (engine && (int32_t)(now - engineUntil) >= 0) engineOff(STOP_TIMEOUT, false);
  if (engine && brakeOn()) engineOff(STOP_BRAKE, false);

  // 트렁크 표시 8초 후 해제
  if (trunkFlag && now - trunkAt > 8000) { trunkFlag = false; sendState(); }

  // BOOT 5초 → 보안 키 재생성
  static uint32_t resetAt = 0;
  if (digitalRead(PIN_RESET_KEY) == LOW) {
    if (!resetAt) resetAt = now;
    if (now - resetAt > 5000) { loadSettings(true); printKey(); delay(500); ESP.restart(); }
  } else resetAt = 0;

  delay(5);
}
