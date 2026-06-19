---
name: changes-0617-thermal-ad
description: "2026-06-17 \"광고 후 발열\" 근본원인 = 보상광고가 켠 AVAudioSession 미해제 + 패치 2건 (v2.1.4)"
metadata: 
  node_type: memory
  type: project
  originSessionId: a045751f-9719-43a9-9236-c3c325b61ae3
---

# 2026-06-17: 광고 후 iOS 발열 근본원인 + 패치 (v2.1.4)

## 증상
2.0.29(ttsUsage 서브컬렉션+profileEssence) 배포로 부분 호전됐으나, **"광고를 보고나면 어김없이 발열 심함 → 음성 인식 막힘"** 잔존. launch/idle이 아닌 **광고 라이프사이클 트리거**.

## 근본원인 (코드+자기주석 검증 확정)
🚨 **보상형 광고(비디오) 흐름에 AVAudioSession 정리 코드 부재.** AdMob SDK가 광고 오디오 재생 위해 `setActive(true)`로 세션을 켜는데, [handleRewardedAd](src/App.jsx)/[handlePronAllowanceAd]의 finally가 세션을 끄지 않음 → mediaserverd awake 잔류 → **정확히 v1.5.67이 고친 발열 재현**(`.playback` 비활성 idle이 정답이었던 그 메커니즘). [BluetoothAudioPlugin.swift:163-165] 주석이 "setActive 미해제 → mediaserverd awake → 발열 → throttling → 마이크 silent capture"를 이미 명시. "어김없이 매번"=모든 광고가 결정론적으로 세션 켜고 흐름이 절대 해제 안 함.
- 정상 녹음 흐름은 정교히 관리됨(모달닫힘 endAudioSession=setActive(false), 카드 10s idle scheduleEndAudioSession) — **광고 흐름만 이 안전장치 우회 구멍**.
🟡 보조: 광고 1회 → 서버 write 2회(adReward 트랜잭션 3필드 + grantBonusPoints batch) → profileEssence가 안 막아 전체 재렌더 2회(일회성 스파이크).

## 왜 ios-heat-guard가 못 잡았나
① diff만 봄(광고 핸들러는 기존코드, 변경 diff에 안 나옴) ② 세션 활성화는 AdMob SDK 런타임 동작이라 소스에 `setActive` 안 보임(정적검사 불가) ③ 체크리스트에 "광고=세션복원" 규칙 부재. → 규칙 보강함.

## 패치 (v2.1.4, 커밋 a6bee7a, 6파일)
1. **App.jsx**: registerPlugin('BluetoothAudio') + 두 광고 finally에 `if (Capacitor.getPlatform()==='ios') BluetoothAudio.endAudioSession?.().catch(()=>{})`. endAudioSession은 v1.5.73부터 존재 → **OTA 배포 가능(네이티브 무빌드)**. 모달닫힘과 동일 검증된 패턴.
2. **AuthContext.jsx**: PROFILE_VOLATILE_FIELDS에 `lastAdRewardAt/adRewardCountDate/adRewardCount/bonusLastGrantedAt/lastTopUpAt` 추가 → 재렌더 2→1. adRewardCountDate는 [App.jsx bumpTtsPoint:874] read하나 localStorage 미러(ttsAdRewardDate)가 1차신호+bonusPoints write가 같은흐름 갱신→안전(최악=TTS넛지 1회 오발화, 자가복구). **lastTopUpDate/bonusPoints는 read되어 제외 유지**.
3. 규칙: CLAUDE.md 규칙6 ⑤ + ios-heat-guard.md 오디오섹션에 "광고 show/dismiss는 endAudioSession으로 감쌀 것, 광고코드는 diff아닌 전체흐름 검토".

heat-guard PASS(2회 점검), lint HEAD대비 0증가, build/check-secrets OK.

## 배포 상태
- **커밋만 됨, 미배포**. 둘 다 JS → Capgo OTA(staging→production) 가능, 서버/네이티브 무변경.
- 검증: 광고 dismiss 후 `[BluetoothAudio] AVAudioSession FULLY ended` 로그 출력 = 호출 발화 증명. 실기기 발열 체감이 최종 지표.
- ⚠️ git add -A 금지(루트에 pk.pem 등 미추적 다수 — 개인키 커밋 위험). 항상 파일 명시 stage.

## 잔여
- 차후 네이티브 빌드 시 thermalState + 세션 category/isActive probe로 정량 확정.
- P1/P2(bonusPoints 분리구독, 탭 React.memo)는 별도 — [[changes-0612-thermal]] 참고. 배너 상시 auto-refresh는 Trial 베이스라인 열원(별건).
