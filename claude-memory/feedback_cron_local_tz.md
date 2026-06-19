---
name: Cron 컷오프 시각은 country IANA TZ 기준이어야 함
description: country별로 발화하는 cron(streak-risk, re-engagement 등)의 "오늘 자정" 같은 컷오프는 server UTC가 아닌 country IANA TZ 기준으로 계산. UTC 쓰면 동쪽 시간대(KST/JST 등) 사용자가 일상 활동만으로 자동 탈락.
type: feedback
originSessionId: 43570a4d-6d9d-41a3-9155-579eec31f327
---
# Cron 컷오프 시각 — country IANA TZ 기준 원칙

country별 슬롯에서 발화하는 cron이 "오늘 자정" 같은 시각 컷오프를 쓸 때는 **반드시 그 country의 IANA TZ 자정**을 계산해 사용한다. server UTC 자정(`new Date(); setHours(0,0,0,0)`)을 그대로 쓰면 안 된다.

## Why

2026-05-15 streak-risk push 발견. `processStreakRiskForCountry`의 컷오프가 server UTC 자정 기준이었음:

```js
// 잘못된 코드 (수정 전)
const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
const tsStartOfToday = Timestamp.fromDate(startOfToday);

// .where('lastActiveAt', '<', tsStartOfToday)
```

Render 서버 UTC 기준으로 UTC 자정 = KST/JST **09:00**. 즉 한/일 사용자가 본인 시간대 09시 이후에 어떤 학습이라도 한 번 했다면 무조건 후보 탈락. 일반인은 09시 이후 활동이 압도적이라 **한/일 streak risk push가 사실상 영영 발송 안 되는 설계 결함**이 됨.

진단 트리거: 사용자 `vTXu7Zl…` 사례 — `lastActiveAt = 2026-05-15 00:45 UTC (= 09:45 KST)` → UTC 00:00 < 00:45 → 후보 쿼리 탈락. 사용자 본인은 "오늘 안 켰음" 인지했으나 실제로 09:45에 학습 액션 1회 있었음.

## How to apply

`server/utils/countryTimezone.js`의 헬퍼 사용:

```js
const { getLocalStartOfToday, getLocalDateStr } = require('../utils/countryTimezone');

// 한 country에 대한 처리 함수에서
async function processForCountry(country, now, opts) {
    const todayStr = getLocalDateStr(country, now);            // 'YYYY-MM-DD' (country local)
    const startOfToday = getLocalStartOfToday(country, now);   // Date (country local 자정)
    const tsStartOfToday = Timestamp.fromDate(startOfToday);
    // ...
}
```

내부 구현은 `Intl.DateTimeFormat({ timeZone: 'Asia/Seoul', ... }).formatToParts(now)` 기반.
`TZ_BY_COUNTRY` 매핑(185개국)이 이미 완비되어 있고 DST도 자동 처리됨.

## 적용 범위 — 다음 경우 모두 점검

- 새 cron 라우트 추가 시 (`processXxxForCountry` 패턴)
- 기존 cron 디버깅 시 — 후보 모수가 예상보다 적게 잡히면 가장 먼저 의심
- "오늘 자정", "지난 24시간", "어제 23시" 같은 시각 필터가 country별로 의미 있어야 하는 경우

## 예외 — 그대로 UTC 써도 되는 경우

- 단순히 retention metric 계산 (전 사용자 공통 기준 필요)
- Audit log timestamp
- country 슬롯 분리 없이 전체 일괄 처리되는 cron

## 관련 파일

- [server/utils/countryTimezone.js](server/utils/countryTimezone.js) — `getLocalStartOfToday`, `getLocalDateStr`, `getLocalDateParts`
- [server/routes/reengagement.js](server/routes/reengagement.js:326) — `processStreakRiskForCountry` (수정 완료 commit `df7d0fd`)
- re-engagement D1~D6 cron (`processWindow`)도 `lastActiveAt` 윈도우를 쓰는데, 현재 UTC 기준일 가능성 — 추후 점검 가치
