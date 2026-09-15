// 광고(AdMob) 전역 kill switch
//
// [2026-08-23] AdMob 계정 정지(2026-08-15~, 심사 ETA 2026-09-15)로 광고가 전달되지 않음.
//   증상 ① 배너: showBanner 후 admob-active 클래스만 붙고 실광고 미노출 → 하단에
//              빈 광고칸 고착 (FailedToLoad 3회 임계는 Loaded/SizeChanged 가 카운터를
//              리셋해 발동하지 않음)
//        ② 보상형: FailedToLoad → alert('광고 오류: ...') 로 유저에게 에러 노출
//   → 전 광고 경로(배너/전면/보상형/TTS 광고 프롬프트)를 JS 레이어에서 차단한다.
//     네이티브 무변경이라 Capgo OTA 로 즉시 배포 가능.
//
// ⚠ 날짜 자동 해제(Date 비교)를 일부러 쓰지 않는다. 계정이 안 풀렸는데 자동으로
//   켜지면 위 증상이 무증상으로 재발한다. 끄고 켜는 건 항상 사람이 콘솔 상태를 보고 결정.
//
// [2026-09-16] 계정 정지 해제 확인 + 보상형 4개 단위에 SSV 콜백 URL 등록 완료 → 재개.
//   재개 전제: 서버는 ADMOB_SSV_ENFORCED(기본 on)로 레거시 지급을 막아둔 상태라, SSV URL
//   미등록 상태에서 켜면 광고를 다 봐도 포인트가 안 들어온다. 다시 끌 일이 생기면 false + OTA.
export const ADS_ENABLED = true;

// 이력 메모 (코드 동작에는 영향 없음)
export const ADS_BLACKOUT_NOTE = '2026-08-15 suspended → 2026-09-16 reinstated (SSV registered)';

// [2026-09-16] 보상형 "보너스포인트 충전" 광고 노출 임계.
//   보유 포인트가 이 값 이상이면 광고를 틀지 않는다 — "쓸 포인트가 남았는데도 광고를 반복 시청"
//   하는 패턴은 AdMob 이 보는 전형적 무효 노출이고, 2026-08-15 계정 정지의 유력 원인군이었다.
//   값 선정: 최대 단일 차감액(Free Talking 10pt) 기준. 5pt 로 잡으면 6pt 보유 유저가
//   FT(10pt)를 실행도 못 하고 충전도 막히는 데드락이 생긴다.
//   ⚠ 발음 한도 광고(bonus02)는 포인트가 아니라 "오늘 발음 횟수" 자원이라 이 임계와 무관.
export const AD_TOPUP_POINT_THRESHOLD = 10;
