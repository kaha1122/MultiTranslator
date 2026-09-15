// 보상형 광고 지급 한도 — adReward.js(레거시 클라 경유)와 admobSsv.js(SSV 콜백)가 공유.
//   [2026-09-16] 과거 두 파일에 상수가 복제되어 "수동 동기" 주석으로 버티던 구조를 제거.
//   ⚠ 클라이언트(src/App.jsx)의 사전 게이트 상수(AD_REWARD_DAILY_CAP 등)는 별도 사본이다 —
//     클라는 "광고를 틀기 전 차단"용 UX 가드일 뿐이고, 지급 권위는 항상 서버(SSV)다.
module.exports = {
    AD_REWARD_AMOUNT: 20,      // 보상형 1회 보너스 포인트
    COOLDOWN_MS: 60_000,       // 보상형 광고 1회 최소 간격(두 유닛 공통)
    DAILY_CAP: 5,              // 하루 보너스 충전 횟수 상한
    PRON_ALLOWANCE: 10,        // bonus02 광고 1회당 오늘 발음 허용량 증가
    PRON_ALLOWANCE_CAP: 5,     // 하루 발음 허용량 충전 횟수 상한(= 최대 +50)
};
