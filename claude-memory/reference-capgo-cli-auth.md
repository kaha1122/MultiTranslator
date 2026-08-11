---
name: capgo-cli-auth
description: "Capgo CLI 인증 — CAPGO_TOKEN 환경변수 + --apikey 옵션 필수. 2026-06-12 전역 CLI 8.2.0. 2026-08-11 토큰이 K-Drama 계정으로 바뀌며 PronunFit 연결 끊김→재등록·재연결 복구."
metadata: 
  node_type: memory
  type: reference
  originSessionId: a1f6e3af-4d21-4dad-9f8f-e1c4957c0bb3
---

# Capgo CLI 인증 방식 (2026-06-12 갱신)

## 현재 권장: 전역 CLI 8.2.0 + --apikey
- 2026-06-12 전역 설치를 `npm install -g @capgo/cli@latest`로 **8.2.0** 업그레이드 (구 전역 7.87.0 교체). `capgo --version` = 8.2.0.
- **`--apikey $env:CAPGO_TOKEN`만 명시하면 8.x에서 정상 동작** — 읽기 전용 조회(channel list/currentBundle) 검증 완료.
- 더는 `@7.111.2` 핀 불필요. `npx @capgo/cli@7.111.2`는 "not the latest" 경고만 유발 → `capgo ...` 또는 `npx @capgo/cli@8 ...` 사용.

## 인증 방법 변경 이력
- **v7.111.2 이하 (구버전)**: `C:\Users\User\.capgo` 파일에 저장된 token 자동 사용. 단 파일 인증 자체는 신버전에서 거부됨.
- **v7.111.7 이상 (8.x 포함)**: 파일 인증이 `Invalid API key or insufficient permissions` 로 거부됨. **`--apikey` 옵션 필수** (안 붙이면 8.x 인증 실패).

## 표준 명령 (현재 작동 확인)

PowerShell에서 실행 (전역 capgo 8.2.0):

```powershell
capgo bundle upload --channel production --apikey $env:CAPGO_TOKEN
capgo channel currentBundle production --apikey $env:CAPGO_TOKEN
```

staging 채널이면 `--channel staging`.

## 환경변수 설정

API key는 User scope 환경변수 `CAPGO_TOKEN`에 저장 — token 값 자체는 chat/git/스크린샷 어디에도 노출 금지 (feedback_no_secrets_in_chat 룰).

```powershell
[Environment]::SetEnvironmentVariable('CAPGO_TOKEN', '<token>', 'User')
```

설정 후 **현재 PowerShell/IDE process 재시작 필수** — User scope 환경변수는 새 process에만 자동 전파됨. 재시작 없이 강제 로드하려면:

```powershell
$env:CAPGO_TOKEN = [System.Environment]::GetEnvironmentVariable('CAPGO_TOKEN', 'User')
```

## 검증 절차

업로드 후 항상 채널 포인터 확인 ([feedback_capgo_verify](feedback_capgo_verify.md) 룰):

```powershell
capgo channel currentBundle production --apikey $env:CAPGO_TOKEN
# 기대값: "Current bundle for channel production is X.Y.Z"
```

## 사용 이력
- v1.5.64 production 배포 (2026-05-26): CLI v7.111.2 + 파일 인증
- v1.5.71 production 배포 (2026-05-27): CLI v7.111.2 + `--apikey $env:CAPGO_TOKEN` (신규 token 사용)
- 2026-06-12: 전역 CLI 8.2.0 업그레이드 + `--apikey`로 read-only 조회 검증. 핀 폐기.

## 🚨 2026-08-11 PronunFit 연결 끊김 → 재연결 복구
증상: "앱이 Capgo 연결 끊긴 듯". `channel currentBundle`가 `App com.arigems.pronunfit does not exist`.

근본 원인 (2가지 겹침):
1. **토큰이 다른 계정으로 바뀜** — 같은 날 신규 앱 **K-DramaAnyLang**(`com.arigems.kdramaanylang`) 설정 과정에서 `CAPGO_TOKEN`이 그 계정 토큰으로 교체됨. 그 계정엔 PronunFit이 없어 전부 "does not exist".
2. **Capgo 대규모 업데이트로 PronunFit 앱 레코드 소실** — 재등록하니 **빈 레코드**(채널 0·번들 0)로 새로 생성됨(원래 번들/통계 이력 미승계).

진단 순서 (재발 시 그대로): `capgo app list --apikey $env:CAPGO_TOKEN` → 토큰에 어떤 앱이 붙어있나 확인이 첫 단추. PronunFit이 목록에 없으면 토큰/계정 문제 확정.

복구 절차 (실행 완료):
1. 앱 재등록 (`capgo app add` 또는 대시보드) → 이후 **K-DramaAnyLang과 PronunFit이 같은 Capgo 계정에 공존**.
2. `npm run build && npm run check-secrets` (PASS: Firebase Web 키만, onrender prod 호스트만 inline).
3. `capgo bundle upload --channel production --bundle 2.1.22 --path dist --apikey $env:CAPGO_TOKEN` → production 채널 자동 생성.
4. `capgo channel set production com.arigems.pronunfit --state default --self-assign --apikey $env:CAPGO_TOKEN` → **Public ✅ + Device Self Set ✅** (capacitor.config `channel:"production"` self-assign 요청 정합에 필수. 이거 안 하면 업로드해도 디바이스 배정 안 됨).
5. 검증: `channel currentBundle production` = 2.1.22, `channel list`에서 Public/Device Self Set/prod 모두 ✅.

미결/주의:
- 원래 PronunFit 전용 Capgo 계정이 따로 있었는지 사용자 미확정 — 현재는 K-Drama 계정에 통합된 상태. 되돌릴 계획이면 재검토.
- `staging` 채널은 아직 없음 (다음 `--channel staging` 첫 업로드 시 자동 생성).
- 교훈: **신규 앱 설정으로 CAPGO_TOKEN을 바꾸면 기존 앱 조회가 전부 깨진다.** 여러 앱을 한 계정에서 관리하거나, 앱별 토큰을 구분해 관리할 것.

## 향후 권장
- 전역 `capgo` (8.2.0) 사용 + 항상 `--apikey $env:CAPGO_TOKEN` 명시
- 버전 핀(`@7.111.2`)은 폐기 — "not the latest" 경고만 났을 뿐 기능 문제 아니었음
