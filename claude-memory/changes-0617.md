---
name: changes-0617
description: 2026-06-17 단어-지문 결합 unit + 중복방지 강화 + Pro 직접입력 게이트 (v2.1.2 배포완료)
metadata: 
  node_type: memory
  type: project
  originSessionId: 05a99c87-3cfb-4db6-8cb7-001aa559ab2c
---

# 2026-06-17 — 결합 unit + dedup + Pro custom (커밋 4ae96bf, v2.1.2)

오전: 포인트 구매 200→500(e34566c) + 네이티브 2.1.1 채번(AAB code36 빌드/서명 완료·미업로드, iOS pbxproj MARKETING_VERSION 2.1.1/build7 → Xcode Cloud 자동 트리거, 1b701c8). **pending-aab item5(billing 8.0.1 force)는 무효 버전이라 빌드 실패 → 제외**([[pending-aab-fixes]] 갱신).

오후 본작업 — 단어/지문 생성 구조 개편 + Pro 수익화. **배포완료**: main push(웹 Vercel + 서버 Render) + Capgo production OTA 2.1.2(currentBundle 검증).

## 핵심 설계 (3목표 동시 해결)
1. **결합 unit**: "지문 먼저 → 지문에서 5단어 verbatim 추출"(generateUnit). 단어⊆지문 구조 보장. 1 Gemini 호출로 지문+단어.
2. **하드 dedup**: 프롬프트 soft 회유로는 `sun`×2 누수 → [server/utils/seedCache.js](server/utils/seedCache.js) `appendAndSlice`에 `dedupeBy` opt-in + `appendItems`(풀 누적) + `normalizeWord`로 저장 직전 정규화 중복 제거.
3. **Pro 직접입력**: custom은 Pro 전용 — 서버 권위 게이트([server/utils/userTier.js](server/utils/userTier.js) getTier, 403 `pro_required`) + 클라 진입부터 잠금.

## 결정 사항 (사용자 확정)
- custom = **per-user 개별 생성·저장**(공유 X) → [server/utils/customUnits.js](server/utils/customUnits.js) `users/{uid}/customUnits/{slug}`. rules는 기존 users catch-all이 커버(추가 X).
- listening 결합 = **B안**(listening 자체 프롬프트에 5단어 추출 추가, 검증된 keyword/angle anti-dup 보존). generateUnit 통일(A) 아님.
- custom 별도 캡 **없음**(구독료 내 포함, Generate의 한 방식).
- essay/dialogue: 각각 독립 unit, 단어는 vocabSeed 한 곳에 모아 공통 dedup.
- **기존 vocabSeed/passageSeed 유지**(리셋·마이그레이션 X) — 생성경로만 통일.

## 주의/한계
- **listening seed 지문 생성이 이제 5단어도 추출→vocabSeed 풀에 dedup append**(전 유저 영향, 추가형이라 무해하나 회귀 관찰 대상).
- **generateUnit의 type='dialogue'는 라우트 미사용**(essay-only 호출). dialogue 지문은 listening 자체 프롬프트가 담당. dialogue 파라미터는 미래 대비.
- 스모크: generateUnit essay 실 Gemini(verbatim 5/5·avoid 0 hit) 통과. **런타임 미검증**(HTTP 라우트·Trial 잠금 UX·Firestore dedup 트랜잭션·listening 단어추출) — 소규모 유저라 정적+스모크로 바로 릴리스.
- 클라 a11y: 잠금 div onClick 키보드 미접근(터치 OK, 발열 무관).

## 후속 배포 (v2.1.3, 커밋 a63c8ad — 배포완료)
- **직접입력 도달성 fix**: custom 입력란이 그동안 **앱 어디서도 도달 불가**였음 — "단어장" 네비=Library([App.jsx:1312](src/App.jsx#L1312)·viewMode 'library'), VocabTab/ListeningTab은 **오직 `startTopicLearning`(preset)으로만 진입**(setViewMode('vocab') 다른 경로 0), 그런데 직접입력란은 `{!preset && ...}` 안이라 숨김 → 결국 노출되는 화면 없음. fix: custom 블록을 `!preset` 밖으로 빼 **토픽 학습(preset) 화면에도 노출**(난이도↔Generate 사이). handleGenerate는 customInput 유무로 custom 우선(preset에선 selectedTopic 노드 유지). **custom 단어/지문 통과도 그 노드 Master에 집계**(onTopicPass preset.topicId 유지 — 사용자 요구: 학습단계 관리 유지).
- **온보딩**(OnboardingPronChallenge): 결과 효과음(>=60 성공/미만 알림) 추가 + 음소 단어 🔊 재생 복원(_skipGate+durable 무과금).

## 기존 중복 보정 (완료, Firestore 직접 write)
- 감사 결과 전체 31 vocabSeed 중 중복은 **2문서 3건뿐**: `morning--basic--ko--en`(sun×2), `morning--basic--ko--zh-CN`(起床×2·然后×2). 나머지 깨끗.
- **대체 보정**(삭제 X, 개수 유지): 중복 항목을 해당 page 지문 등장 단어로 교체 — en sun@10→**rises**, zh-CN 起床@5→**鸡蛋**·然后@8→**热茶**(전부 verbatim·무충돌). 첫 등장은 보존.
- **백업**: `vocabSeedBackup/{key}`에 원본 words 보존(롤백용, reason='dup-fix-0617'). 재감사 0 중복 확인.
- ⚠️ Render 서버 in-memory LRU(seedCache mem)가 이 2키를 캐시 중이면 **다음 재시작/배포 전까지 구버전(중복) 서빙 가능** — Firestore canonical은 보정됨, cosmetic이라 강제 redeploy 안 함(다음 배포 시 자연 해소).

## 후속 가능
- pending-aab item5 재시도 시 실게시 billing 버전부터 조사.
- AAB 2.1.1(code36) Play Console 업로드 + 양 스토어 공개 후 `config/app.latestNativeVersion="2.1.1"` 수동.
