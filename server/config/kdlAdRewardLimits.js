// K-DramaAnyLang 보상형 광고 지급 한도 — routes/kdlAdmobSsv.js(SSV 콜백, 지급 권위)와
//   routes/communityPoints.js(레거시 ad-reward, 롤백용)가 공유. 클라(src/config/points.js)는 UX 게이트용 별도 사본 — 수동 동기.
// 2026-09-16 사용자 확정: 30pt×일5회 → **10pt×일5회 + 잔액 10pt 미만일 때만**(POINTS_ECONOMY_V2 §9-1의 "일 2회"는 5회로 통일).
module.exports = {
    AD_REWARD_AMOUNT: 10,   // 시청 1회 지급
    COOLDOWN_MS: 60_000,    // 60초 쿨다운
    DAILY_CAP: 5,           // 일 5회(UTC) → 일 최대 +50pt
    MIN_BALANCE: 10,        // 잔액이 이 값 미만일 때만 지급(잔량 미소비 상태에서 광고만 연속 시청해 쌓는 것 차단)
};
