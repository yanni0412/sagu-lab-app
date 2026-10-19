# 카온 워치 (Wear OS)

갤럭시 워치5 등 **Wear OS 3/4** 스마트워치용 카온 앱이에요. 워치의 블루투스로
차량 모듈(크라운 호환 MP686 또는 카온 ESP32)에 **직접** 연결해 잠금·열림·트렁크·
찾기·원격 시동을 제어해요. 휴대폰 없이 워치만으로 동작하는 standalone 앱입니다.

- 화면: `index.html` (둥근 화면용 큰 버튼 UI) — 휴대폰 앱과 동일한 BLE 프로토콜
- Android(Wear OS) 프로젝트: `caron-watch-app/` (Capacitor, `com.honeyappa.caronwatch`, minSdk 30)

## 설치 (APK)

1. GitHub → **Actions → Build CarOn Watch APK** → 최신 실행 → Artifacts의 `caron-watch-debug-apk`
2. 워치에 설치: 워치 개발자 옵션에서 **ADB 디버깅/무선 디버깅**을 켜고
   `adb connect <워치IP>:<포트>` 후 `adb install app-debug.apk`
   (또는 휴대폰을 거쳐 사이드로드)
3. 워치에서 블루투스 권한 허용

## 사용

- 첫 실행: 가운데 **기기 설정** → 크라운 호환(MP686) → 비밀번호(기본 000000) → 기기 선택
- 열기/잠그기/찾기: 한 번 탭 · 트렁크/시동: 길게 누르기
- 기기가 없으면 **데모**로 화면을 체험할 수 있어요

## 한계

- 워치 키보드 입력이 불편해서 ESP32의 32자리 보안 키 입력은 권장하지 않아요(휴대폰 앱 사용). 워치는 주로 MP686용이에요.
- WearOS WebView 기반이라 네이티브(Compose) 앱보다 가볍지만 투박할 수 있어요. 더 다듬으려면 네이티브로 다시 만들 수 있어요.
- 워치가 차량 모듈의 블루투스 범위(약 10m) 안에 있어야 해요.
