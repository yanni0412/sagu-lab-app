# 사구 궤적 실험실 — Android 앱

`sagu-lab.html`(물리 시뮬레이터 + 미션·스테이지·꾸미기)을
[Capacitor](https://capacitorjs.com/)로 감싼 Android 프로젝트입니다.
웹 화면은 `www/index.html`에, 실제 Android Studio 프로젝트는 `android/`에 있습니다.

### 분자 뷰어 (`www/chem.html`)

상단 바의 **⚗ 분자 뷰어** 버튼으로 여는 별도 화면입니다. 화학식(`H2O`, `CuSO4·5H2O`),
물질 이름(`카페인`), SMILES(`c1ccccc1`)를 입력하면 구조식(전체·축약·골격·공-막대·3D 회전)과
몰 질량·원소별 질량 %·불포화도를 보여 줍니다. 외부 라이브러리 없이 동작하며,
파싱·배치 로직은 `www/chem-core.js`에 있습니다.

---

## 0. 전체 흐름 한눈에 보기

1. GitHub 저장소에 이 폴더를 올린다
2. Google Play 개발자 계정을 만든다 (등록비 25달러, 1회)
3. 업로드용 서명 키(keystore)를 만든다
4. GitHub Actions로 서명된 `.aab`를 자동 빌드한다
5. Play Console에서 앱을 등록하고, 스토어 정보·개인정보처리방침·콘텐츠 등급을 채운다
6. 비공개 테스트(신규 개인 계정은 필수) → 프로덕션 출시 신청

---

## 1. GitHub에 올리기

```bash
cd sagu-lab-app
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin <내 저장소 주소>
git push -u origin main
```

---

## 2. Google Play 개발자 계정 만들기

1. https://play.google.com/console/signup 접속, Google 계정으로 로그인
2. 계정 유형 선택 — 개인용 개발자 계정으로 만들면 아래 "비공개 테스트 요건"이 적용됩니다.
   (사업자로 등록되어 있다면 조직 계정도 가능하지만 서류 확인이 더 필요합니다.)
3. 개발자 배포 계약 동의
4. 등록 수수료 **US$25 1회 결제**
5. 신원 확인 절차 진행 (신분증 등 — 계정 유형에 따라 다름, Play Console 화면 안내를 따라가면 됩니다)
6. **2023년 11월 13일 이후 만든 개인 계정은 비공개 테스트 요건이 있습니다**:
   프로덕션(정식 출시) 전에 **12명 이상의 테스터가 최근 14일간 계속 테스트에
   참여한 상태**여야 합니다. 처음부터 이걸 염두에 두고 진행하세요
   (가족·지인 12명에게 링크를 보내 테스터로 등록시키면 됩니다).

## 3. 업로드용 서명 키(keystore) 만들기

로컬에 JDK가 설치되어 있으면(Android Studio를 깔면 같이 설치됩니다)
터미널에서:

```bash
keytool -genkeypair -v -keystore release.keystore \
  -alias sagulab -keyalg RSA -keysize 2048 -validity 10000
```

몇 가지 질문(비밀번호, 이름 등)에 답하면 `release.keystore` 파일이
만들어집니다. **이 파일과 비밀번호는 잃어버리면 안 됩니다** — 잃어버리면
같은 앱으로 업데이트를 낼 수 없게 되어 새 앱으로 다시 올려야 합니다.
안전한 곳(비밀번호 관리자 등)에 백업해두세요.

## 4. GitHub Actions로 서명된 AAB 자동 빌드

1. 방금 만든 `release.keystore`를 base64로 인코딩합니다.
   ```bash
   base64 -i release.keystore | tr -d '\n' > release.keystore.base64.txt
   ```
2. GitHub 저장소 → **Settings → Secrets and variables → Actions** 에서
   아래 4개의 **Repository secret**을 등록합니다.

   | 이름 | 값 |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | 위에서 만든 `release.keystore.base64.txt` 내용 전체 |
   | `ANDROID_KEYSTORE_PASSWORD` | keytool에서 입력한 키스토어 비밀번호 |
   | `ANDROID_KEY_ALIAS` | `sagulab` (위 명령의 `-alias` 값) |
   | `ANDROID_KEY_PASSWORD` | keytool에서 입력한 키 비밀번호 |

3. 저장소의 **Actions** 탭 → **Build Signed Release AAB** →
   **Run workflow** 버튼으로 수동 실행합니다.
4. 완료되면 실행 결과 페이지의 **Artifacts**에서 `sagu-lab-release-aab`를
   내려받습니다. 압축을 풀면 `app-release.aab`가 나옵니다 — 이걸
   Play Console에 업로드하면 됩니다.

> 참고: `Build Android APK` 워크플로우(코드 push 시 자동 실행)는 테스트용
> **디버그 APK**만 만듭니다. 스토어 제출은 반드시 위 **서명된 AAB**를
> 사용하세요. 로컬에서 직접 서명 빌드하려면 `android/keystore.properties.example`을
> 복사해 `android/keystore.properties`로 저장하고 값을 채운 뒤
> (이 파일은 git에 올라가지 않습니다):
> ```bash
> cp release.keystore android/app/release.keystore
> cd android && ./gradlew bundleRelease
> ```

## 5. Play Console에서 앱 등록

1. Play Console → **앱 만들기** → 앱 이름(예: 사구 궤적 실험실), 기본 언어(한국어),
   앱/게임 여부, 무료/유료 선택
2. **정책 → 앱 콘텐츠**에서 순서대로 채우기:
   - **개인정보처리방침**: `PRIVACY_POLICY.md`를 GitHub Pages 등으로 호스팅해서
     그 URL을 등록하세요. (예: 저장소 설정 → Pages → main 브랜치로 켜면
     `https://<내계정>.github.io/<저장소>/PRIVACY_POLICY.md` 형태로 접근 가능.
     보기 좋게 하려면 `.md`를 `.html`로 바꿔서 올리는 걸 추천합니다.)
     **문서 안의 `[개발자 이름/연락처 이메일을 여기에 채워주세요]` 부분은 실제 정보로 꼭 바꿔주세요.**
   - **데이터 보안(Data safety) 설문**: 이 앱은 로컬 저장소에만 진행 기록을
     저장하고 서버로 전송하지 않으므로 "수집하는 사용자 데이터 없음"에 가깝게
     답하면 됩니다. Google Fonts를 불러오는 표준 웹 요청이 있다는 점만
     참고하세요(개인 식별 정보 수집 아님).
   - **콘텐츠 등급 설문**: 폭력·도박·성인 콘텐츠 없음으로 답하면 대체로
     "전체 이용가" 등급이 나옵니다.
   - **광고**: 광고 없음으로 표시
   - **대상 연령층 / 타겟 오디언스**
3. **스토어 등록정보** 작성:
   - 앱 이름(최대 30자), 간단한 설명(80자), 자세한 설명(4000자)
   - **아이콘**(512×512), **피처 그래픽**(1024×500), **스크린샷**(폰 최소 2장)
     — 지금 프로젝트의 아이콘은 Capacitor 기본 아이콘이므로, Android Studio의
     **Image Asset** 도구나 디자인 툴로 실제 아이콘/스크린샷을 새로 준비하세요.
4. **프로덕션(또는 먼저 비공개 테스트) → 새 버전 만들기**에서 4단계에서
   받은 `app-release.aab`를 업로드, 출시 노트 작성
5. 개인 계정이면 먼저 **비공개 테스트** 트랙에 올려 테스터 12명을
   14일 이상 확보한 뒤, 대시보드에서 **프로덕션 액세스 신청** →
   심사 통과 후 정식 출시

## 웹 내용을 수정했다면

`www/index.html`을 새 버전으로 교체한 뒤:

```bash
npm install
npx cap sync android
```

그 다음 versionCode/versionName을 올리고(`android/app/build.gradle`의
`versionCode`, `versionName`) 다시 4단계 워크플로우를 실행하면 됩니다.
**업데이트를 낼 때마다 `versionCode`를 1씩 반드시 올려야** Play Console이
새 버전으로 인식합니다.

## 아이콘/앱 이름 바꾸기

- 앱 이름: `capacitor.config.ts`의 `appName`, 그리고
  `android/app/src/main/res/values/strings.xml`
- 패키지 ID: `capacitor.config.ts`의 `appId` (현재 `com.honeyappa.sagulab`,
  **한 번 스토어에 올리면 이후 변경 불가**하니 신중히 정하세요)
- 아이콘: `android/app/src/main/res/mipmap-*` 폴더의 이미지를 교체하거나,
  Android Studio의 **Image Asset** 도구를 사용하세요.
