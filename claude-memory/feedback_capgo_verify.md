---
name: capgo-bundle-verify
description: Capgo bundle upload 후 반드시 channel currentBundle 명령으로 업로드 버전과 채널 포인터 일치 확인 (과거 반복적으로 누락됨)
type: feedback
originSessionId: 3e6e168e-bb68-44ce-83d6-9ce816577575
---
Capgo CLI `bundle upload --channel <channelName>` 명령 실행 직후, **반드시** 다음 명령으로 채널의 current bundle이 방금 업로드한 버전과 일치하는지 확인할 것.

```bash
npx @capgo/cli channel currentBundle <channelName>
# 예: npx @capgo/cli channel currentBundle staging
# 출력: "Current bundle for channel <channelName> is <version>"
# → <version>이 방금 upload한 버전과 동일해야 함
```

**불일치 시**: 업로드는 됐지만 채널 링크 단계가 유실된 상태 → 기기는 여전히 이전 번들 받음. 수동 링크 필요:
```bash
npx @capgo/cli channel set <channelName> --bundle <version>
```

**Why:** 과거 여러 번 반복 발생한 문제. `bundle upload --channel` 명령은 내부적으로 2단계(① 번들 업로드 ② 채널 링크)인데, ② 단계가 네트워크 타임아웃/rate limit 등으로 조용히 실패해도 CLI는 "Bundle uploaded 💪" 성공 메시지만 출력. 육안으로 구분 불가 → 확인 명령 필수. 2026-04-18 v1.4.24 업로드에서 staging 포인터가 1.4.23에 남아 기기가 최신 번들 못 받는 문제 재발.

**How to apply:**
- Capgo staging/production 채널에 bundle upload를 수행하는 모든 경우 적용.
- 업로드 직후 한 줄 명령 체크 → 불일치면 즉시 `channel set`으로 보정.
- 사용자에게 배포 완료 보고하기 전에 검증 완료한 상태여야 함.
- grep으로 CLI 출력 필터링할 때 "Link device to this bundle"/"Current bundle"/"staging channel" 등의 성공 신호도 놓치지 않도록 필터 범위 넓히거나 전체 출력 보기.

## CLI 가 "Cannot get permissions for organization" 을 낼 때 — REST 우회 (2026-09-16 확정)

Capgo 백엔드의 조직 권한 RPC(CLI 의 channel/bundle 명령이 모두 경유)가 죽으면 `channel currentBundle` /
`channel set` / `channel list` / `bundle list` 가 **전부** 이 오류를 내고, `app list` / `organization list` 만 된다.
CLI 7.111.2 / 8 동일, 키·권한(org_super_admin) 정상, 다른 앱도 동일 → 키 문제 아님. 2026-09-15 Supabase
JWT/pgBouncer 인시던트 뒤 status 페이지가 "해결"이어도 1시간+ 지속됐다. **공개 REST API 는 같은 API 키로 정상 동작**하므로
이걸로 검증·배정한다(`$CAPGO_TOKEN` 은 Bash 환경변수, 값을 출력하지 말 것):

```bash
# 채널 포인터 조회 — version.name 이 방금 올린 버전이어야 함
curl -s -H "authorization: $CAPGO_TOKEN" "https://api.capgo.app/channel?app_id=com.arigems.pronunfit"   | python -c "import sys,json; [print(c['name'],'->',c['version']['name']) for c in json.load(sys.stdin)]"

# 번들 존재 확인
curl -s -H "authorization: $CAPGO_TOKEN" "https://api.capgo.app/bundle?app_id=com.arigems.pronunfit" | head -c 400

# 채널에 번들 배정 (= channel set) → {"status":"ok"} 후 위 조회로 재검증
curl -s -X POST -H "authorization: $CAPGO_TOKEN" -H "content-type: application/json"   -d '{"app_id":"com.arigems.pronunfit","channel":"production","version":"2.1.28"}' "https://api.capgo.app/channel"
```

채널 JSON 에서 함께 볼 것: `rolloutEnabled`(true 면 `rolloutPercentageBps` 만큼만 배포), `allow_emulator`(false 면
에뮬레이터는 업데이트 안 받음 — 실기기로 테스트), `disableAutoUpdateUnderNative`(true 면 네이티브 versionName 보다
낮은 번들은 적용 안 됨 — 네이티브 채번 후 OTA 는 반드시 그보다 높게).
