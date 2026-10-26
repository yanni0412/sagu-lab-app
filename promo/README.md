# 홍보 영상 (HyperFrames)

`renders/sagu-lab-promo.mp4` — 1920×1080, 30fps, 21초. 앱 화면은 전부 실제 앱(`www/index.html`)을 캡처한 것입니다.

| 구간 | 장면 | 파일 |
|---|---|---|
| 0–3.5초 | "치기 전에, 궤적부터 본다." + 조준 화면 | `compositions/hook.html` |
| 3.5–11.5초 | 실제 샷 리플레이 + "득점 1점" | `compositions/replay.html` |
| 11.5–17.5초 | 당점·회전 → 파이브 앤 하프 → 훈련·미션 | `compositions/features.html` |
| 17.5–21초 | 로고 + "Google Play에서 만나요" | `compositions/endcard.html` |

## 수정·다시 렌더링

```bash
cd promo
npx hyperframes@0.8.204 preview      # 브라우저에서 미리보기·편집
npx hyperframes@0.8.204 check        # 검사
npx hyperframes@0.8.204 render -q delivery -o renders/sagu-lab-promo.mp4
```

- 문구는 각 `compositions/*.html` 안의 텍스트를 바꾸면 됩니다. 엔딩 버튼 문구는 `index.html`의 `data-variable-values`에서 바꿉니다.
- 앱 화면이 바뀌면 `node scripts/capture.cjs`로 다시 캡처합니다(사용법은 파일 맨 위 주석 참고).
- 한글 폰트(Gothic A1, IBM Plex Sans KR, OFL 라이선스)는 자주 쓰는 한글 2,350자만 남긴 woff2입니다. 그 밖의 드문 글자를 쓰면 빈칸으로 보일 수 있습니다.
- GSAP은 CDN 대신 `assets/vendor/gsap.min.js`에 넣어 두었습니다(오프라인 렌더링용).
- 현재 영상은 소리가 없습니다.
