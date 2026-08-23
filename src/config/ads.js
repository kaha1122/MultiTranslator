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
// ⚠ 날짜 자동 해제(Date 비교)를 일부러 쓰지 않는다. 9/15에 계정이 안 풀렸는데 자동으로
//   켜지면 위 증상이 무증상으로 재발한다. 복구는 반드시
//   ① AdMob 콘솔에서 노출 재개 확인 → ② 이 값을 true → ③ 빌드/OTA 순서로.
export const ADS_ENABLED = false;

// 복구 시점 판단용 메모 (코드 동작에는 영향 없음)
export const ADS_BLACKOUT_NOTE = '2026-08-15 AdMob account suspension; review ETA 2026-09-15';
