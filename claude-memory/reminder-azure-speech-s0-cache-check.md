---
name: Azure Speech S0 propagation 체크 (2026-04-25)
description: F0→S0 전환 후 "첫 시도 실패 → 2차 성공" 패턴 자연 해소 여부 확인. 미해소 시 Key 재생성.
type: project
originSessionId: d874b2d1-2d2d-412e-8cd0-be8d5673e04d
---
# 🔔 Azure Speech S0 Cache Coherency 자연 해소 확인 — 2026-04-25 체크

## 배경
2026-04-24 장애 대응으로 Azure Speech 리소스(TrnslatorApp)를 **F0 Free → S0 Standard** 업그레이드 완료. 즉시 API 정상화가 아니라 **Quota Cache Coherency Lag** 현상 관측:
- 1차 시도: `errorDetails="Quota exceeded"` 실패
- 2차 시도(500ms 뒤): `reason=RecognizedSpeech` 성공
- 서버 재시도 로직([analyze.js](server/routes/analyze.js) 커밋 d33bc20)이 유저에겐 투명하게 복구 중

## 내일(2026-04-25) 체크할 것

**Render 로그에서 패턴 빈도 확인** (최근 1시간):
```
[Azure] Pronunciation retry succeeded on attempt 2
```
이 줄이 얼마나 자주 찍히는지 관찰.

### 판정 기준

| 1차 성공률 | 해석 | 조치 |
|---|---|---|
| **>70%** | Azure quota 캐시 reconciliation 진행 중 | 추가 대기 (수 시간~1일 더) |
| **>95%** | 완전 해소 | 종료. retry 로직은 그대로 두기 (future transient 대비) |
| **<30%** | 자연 해소 실패 | 🔴 **Key 재생성 진행** (아래 절차) |

## Key 재생성 절차 (필요 시)

1. **Azure Portal** → `TrnslatorApp` (Speech 리소스)
2. 왼쪽 사이드바 → **"키 및 엔드포인트"**
3. **"Key 1"** 오른쪽 **🔄 재생성** 버튼 클릭 → 새 키 복사
4. **Render Dashboard** (multitranslator) → **Environment** 탭
5. `AZURE_SPEECH_KEY` 값 교체 → **Save** (자동 재배포 2~3분)
6. 배포 후 앱 테스트 + Render 로그 확인
7. 성공 확인되면 Azure Portal에서 **Key 2** 재생성(구 키 무효화) — 선택

**주의**:
- Key 재생성은 Azure 백엔드 entitlement 전체를 처음부터 빌드 → Cache coherency 완전 리셋
- Render env var 업데이트 시 실 유저가 재배포 중(~2분) 502 볼 수 있음 — 한국 새벽/일요일 같은 저트래픽 시간 추천

## 관련 리소스 정보
- 상세: [azure-speech-resource.md](azure-speech-resource.md)
- 오늘의 작업: [changes-0424.md](changes-0424.md)

## 완료 조건
- 1차 시도 성공률 >95% 확인 → 이 리마인더 삭제
- 또는 Key 재생성 후 정상화 확인 → 이 리마인더 삭제
