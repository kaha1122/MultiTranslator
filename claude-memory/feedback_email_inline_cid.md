---
name: 이메일 이미지는 inline cid attachment로 (Gmail 외부 차단 우회)
description: 신규 발신자 도메인의 외부 이미지 URL은 Gmail이 기본 차단. cid:reference inline 첨부가 표준
type: feedback
originSessionId: c6698add-4a6d-4a17-9a62-7d4c04af08b6
---
# 이메일 이미지 — inline `cid:` attachment 사용

## 규칙

이메일 본문에 이미지 포함 시 **외부 URL `<img src="https://...">` 사용 금지**. 대신 **Resend `attachments` + `cid:` 참조**로 inline 첨부.

**Why**: Gmail/Outlook은 신규 발신자 도메인의 외부 이미지를 기본 차단 (security/privacy). 사용자가 "이미지 표시" 직접 클릭해야 로드. 첫 캠페인 발송에서 90%+ 수신자에게 깨진 placeholder로 보임.

**How to apply**: Resend 사용 시:
```js
attachments: [{
    filename: 'image.jpg',
    content: imgBuffer,        // fs.readFileSync로 읽기 (서버 메모리 캐시)
    contentType: 'image/jpeg',
    contentId: 'my-image',     // HTML <img src="cid:..."> 와 일치
}]
```
HTML: `<img src="cid:my-image" alt="...">`

→ 모든 메일 클라이언트에서 외부 차단 무관 정상 표시. Buffer는 첫 호출 시 read 후 모듈 변수로 캐시 (반복 read 방지).

## 사고 사례 (2026-05-04)

VN Free Talk 캠페인 첫 테스트 발송 시 외부 URL `https://pronunfit.com/email-assets/free-talk-vn.jpg` 사용. Vercel 호스팅 정상(303KB JPEG, HTTP 200) 확인됐지만 Gmail 수신함에서 broken-image + alt text "Free Talk demo screenshot" 만 표시.

해결: `attachments` + `cid:` 로 변경 (commit `b8d4838`). 본인 폰에서 inline 정상 표시 확인 후 106명 발송.

## 비용 영향

- 메일당 +이미지 크기 (예: 303KB)
- 총 발송 시 ×N → 대량 시 bandwidth 고려
- Resend 무료 한도(3K/월)와 별개로 transfer 한도 체크
- 일반적으로 100~500명 캠페인엔 무관

## 단점 / 대안

- 매우 큰 이미지(>1MB)는 inline 비효율 → 외부 URL + 명시적 "이미지 표시 안내" 추가 또는 압축
- 동일 이미지를 여러 메일에서 사용 시 inline 중복 → 일반적으론 재사용 빈도 낮아 무시 가능

## Phase 2 — 발신자 reputation 쌓인 후

수개월 발송 + 0% spam 신고 누적되면 발신자 신뢰도 ↑ → 외부 URL 이미지도 자동 표시 가능. 단, 신뢰도 쌓이기 전엔 inline 권장.
