---
name: changes-0603
description: "2026-06-03 — Free Talking 재질문 회귀 3단 해결(A: history slice -8→-30 / B: establishedFacts slot memory 클라+서버 / 대화 로그 freeTalkTranscripts text-only+30일 TTL) + endedReason 사유 정리 + Capgo prod 1.5.88→1.5.89"
metadata: 
  node_type: memory
  type: project
  originSessionId: b1cc88f4-cf0b-42bd-8f30-46abd5e16027
---

# 2026-06-03 — Free Talking "직전 대화 기억 못함/재질문" 회귀 근본 해결 + 운영용 대화 로그 도입

사용자 보고: Free Talking에서 AI(예: hospital pharmacist)가 이미 받은 정보(생일 "April 14th", 연도 "1971")를 계속 재질문하며 루프. "프롬프트 보완했는데도 재발". 진단 → A/B 2단 fix + 운영/버그추적용 대화 로그까지 3건 배포.

## 0. endedReason 사유 정리 (코드 확인)
`useConversation.js`의 freeTalkHistory `endedReason` 값 종합:
- **명시/상태 종료**: `user`(X버튼 endSession), `limit`(턴한도 도달, TURN_LIMITS=5 전 tier), `idle`(IDLE_TIMEOUT 30분), `unknown`(fallback)
- **lifecycle 종료**(사용자 X 안 눌러도 캡처, `lifecycle_${source}`): `lifecycle_appstate`(Capacitor appStateChange isActive:false — **네이티브 앱 백그라운드 진입**: 홈버튼/앱전환/잠금/전화/강제종료 직전), `lifecycle_visibility`(웹 탭 숨김), `lifecycle_pagehide`(웹 페이지 언로드)
- `lifecycle_*` = 대화 도중 앱/탭 이탈 → 중도이탈 지표. idempotent 가드(`if(last.endedAt)return`)로 세션당 최초 1회만 기록.

## 1. A안 — history 윈도우 복원 (서버, commit 9ef7d98)
- **근본**: `server/utils/conversationPrompt.js` buildReplyPrompt의 `history.slice(-8)`이 후반 턴에서 opener(시나리오 전체 맥락)+초반 사실을 잘라냄. TURN_LIMITS=5라 유효 history 최대 ~12엔트리뿐인데 8로 자름.
- 2026-05-21 "12→8(31KB→28KB,-10%)" 축소는 **오최적화**: 28KB 대부분이 정적 규칙이고 history block은 턴당 ~100~200자 → 토큰 절감 미미, 기억력만 손상.
- **fix**: `slice(-8)` → `slice(-30)` (5턴 세션 전체 항상 포함 + 폭주 방어 cap). 클라는 이미 전체 history 전송 중이었음 → 서버 truncation이 유일 병목.
- 서버 전용 → Render 자동 배포. main push로 Vercel prod도 갱신.

## 2. B안 — establishedFacts slot memory (클라+서버, commit b0a702a, v1.5.88)
- **이유**: 윈도우 안에 맥락이 있어도 Flash-Lite가 복합 사실(한 답변에 월+일 동시) 추적 실패 — "다음 슬롯 묻기" 패턴매칭만 하고 "모든 슬롯 찼는지" 점검 누락. prose 규칙(GOLDEN RULE/NO REDUNDANT ASKING) 강화만으론 한계 입증.
- **설계**: aiReply JSON에 `establishedFacts` 누적 배열 필드 신설. 모델이 매 턴 cumulative 출력 → 클라가 마지막 ai 메시지에 저장 → 다음 턴 carry → 서버가 프롬프트에 "이미 확정됨, 재질문 절대 금지, 다 차면 advance" 체크리스트로 주입.
- **파일**:
  - `conversationPrompt.js`: 시그니처 establishedFacts 파라미터, Conversation Context에 RUNNING STATE 블록, Phase1 HARD RULES에 composite-answer 규칙(DOB 워크드 예시), 출력 JSON 누적 필드
  - `server/routes/converse.js`: establishedFacts 수신/전달 + 응답 정규화(모델 누락/드롭 시 prior 유지 union fallback — 메모리 유실 차단)
  - `src/hooks/useConversation.js`: priorFacts 추출(마지막 ai 메시지) → 요청 carry → 응답 저장(누락 시 prior). edit/remove 시 메시지 trim과 함께 자연 롤백.
- A안과 상호보완: 윈도우 잘려도 facts state 생존. establishedFacts는 in-memory + 요청 본문 only — **Firestore 미저장**(처음엔), Gemini 전송은 기존 history와 동일 범주.
- graceful degradation: 구버전 클라/서버 어느 쪽이든 무지 필드 무시 → 안전.

## 3. 대화 로그 freeTalkTranscripts (운영/버그추적용, 클라 전용, commit ac348f7, v1.5.89)
- **목적(b)**: 재질문 회귀 같은 버그 사후 추적. 사용자 노출 X. **text only**(audio 미저장).
- **저장 위치**: `users/{uid}/freeTalkTranscripts/{sessionId}` — 세션당 1문서. 세션 ~5KB.
- **턴 스키마**(slim): `{r: 'n'|'ua'|'u'|'a', t: fullText}` + user 턴 `raw`(sttRaw)/`c`(intentWasCorrected) + **AI 턴 `f`(establishedFacts 스냅샷 — 재질문 추적 핵심)**. id/audio/words 제외.
- **세션 메타**: key/scene/category/targetLang/sourceLang/difficulty/speechStyle/tier/platform/appVersion/startedAt/endedAt/durationMs/freeTurnCount/turnLimit/endedReason/expiresAt
- **쓰기 시점**: 턴마다 debounced flush(`in_progress`) + 종료 sessionEnded(실제 reason) + lifecycle handler(`lifecycle_*`) + resetSession(`closed`). 기존 freeTalkHistory 쓰기 훅 재사용.
- **terminal-lock**(`terminalReasonWrittenRef`): 첫 종료 사유 확정 후 후행 write 전면 차단 → 종료 3초 뒤 펜딩 debounced flush가 endedReason을 'in_progress'로 되돌리는 **clobber 방지**. sig dedup으로 lifecycle 다중발화 중복도 방지. start/reset 시 refs 초기화.
- **TTL**: 필드 `expiresAt`(기존 migrationArchive/pronunciation_records 컨벤션 일치, `expireAt` 아님), 30일. **Firebase 콘솔엔 TTL 없음 → GCP 콘솔 Firestore→TTL**에서 정책 생성(컬렉션그룹은 문서 1개 생긴 뒤에야 드롭다운에 등장). 사용자 생성 완료(Building→Serving).
- **보안규칙**: 추가 불필요 — 기존 `match /users/{userId}/{document=**}` owner catch-all이 신규 서브컬렉션 자동 커버.
- **계정삭제**: 추가 불필요 — `server/routes/account.js`가 `userRef.listCollections()`로 모든 서브컬렉션 자동 cascade 삭제. (anon→실계정 마이그도 listCollections로 자동, 디버그 데이터라 제외는 미적용)
- 서버 변경 0. 클라 전용. 단 main push로 **웹 prod는 즉시 로그 기록 시작**(모바일만 staging 게이팅 의미).

## 4. 배포 내역
- Capgo: staging 1.5.88→검증→production 승격(B안). 이후 1.5.89 staging→테스트→production 승격(대화 로그). CLI `@7.111.2 --apikey $CAPGO_TOKEN`, 업로드 후 `channel currentBundle` 검증, 승격은 재업로드 아닌 `channel set production --bundle <v>`(포인터만 이동).
- 커밋 메시지 작성 시 bash 툴에서 PowerShell here-string(`@'...'@`) 쓰면 `@`가 메시지에 새어들어감 → heredoc(`cat > f <<'EOF'`) + `git commit -F` 사용.

## 재사용 패턴 / 교훈
- **대화 일관성 작은모델 한계**: prose 규칙만으론 multi-slot 추적 실패. 명시적 누적 상태(slot memory)를 모델이 출력→carry→재주입하는 구조가 근본해결. [[feedback_client_server_parity]] 준수(클라+서버 병행).
- **prompt 토큰 최적화 시 history block ≠ 정적 규칙** — history는 작음. 세션이 짧으면(턴한도) 전체 전송이 정답.
- **Firestore TTL**: 필드는 Timestamp 타입 필수, 필드명은 프로젝트 컨벤션 `expiresAt` 통일, 정책은 GCP 콘솔(Firebase 콘솔 X), 삭제는 best-effort(~24~72h). owner catch-all + listCollections cascade 덕에 신규 user 서브컬렉션은 규칙/삭제 추가 불요.
