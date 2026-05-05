# Gmail Send-As 이메일 캠페인 셋업 가이드

`scripts/send_kr_email_via_gmail.py` 실행을 위한 일회성 셋업.

## 1. Gmail App Password 발급

### 전제조건
- Google 계정 (sw.haka@gmail.com) 에 **2단계 인증 활성** 필수
- "Send as" alias 가 `systemadmin@pronunfit.com` 으로 이미 설정됨 (Gmail 설정 → 계정 → 다른 주소에서 메일 보내기)

### 단계
1. https://myaccount.google.com/security 접속
2. **2단계 인증** 클릭
3. 같은 페이지 하단 **앱 비밀번호** 클릭
4. **앱 선택**: "메일", **기기 선택**: "Windows 컴퓨터" (또는 "기타" → 이름 `pronunfit-campaign`)
5. **생성** 클릭 → 16자리 비밀번호 표시됨 (공백 4×4)
6. 비밀번호 복사 (이 화면 떠나면 다시 못 봄)

### 환경변수 설정 (Windows PowerShell)

```powershell
$env:GMAIL_APP_PASSWORD = "xxxx xxxx xxxx xxxx"
```

(Bash):
```bash
export GMAIL_APP_PASSWORD="xxxxxxxxxxxxxxxx"
```

⚠️ **chat·screenshot에 절대 공유 금지**. 환경변수에만 두기.

## 2. Firebase Service Account JSON

### 단계
1. https://console.firebase.google.com/ 접속
2. **trnaslatorapp** 프로젝트 선택
3. ⚙️ (왼쪽 상단 톱니바퀴) → **프로젝트 설정**
4. 상단 탭에서 **서비스 계정** 클릭
5. 하단 **새 비공개 키 생성** 클릭 → JSON 다운로드
6. 안전한 위치에 저장 (예: `C:\private\firebase-key.json`)
   - ⚠️ **절대 git 디렉토리에 저장 금지**
   - 절대 commit 금지 — 이 키로 Firestore 전체 read/write 가능

### 환경변수 설정

```powershell
$env:FIREBASE_SERVICE_ACCOUNT = "C:\private\firebase-key.json"
```

```bash
export FIREBASE_SERVICE_ACCOUNT="/path/to/firebase-key.json"
```

## 3. Python 의존성

```powershell
pip install firebase-admin
```

(이미 설치됐으면 skip)

## 4. 실행

### 4-1. dryRun (대상자 리스트만 확인)

```powershell
python scripts/send_kr_email_via_gmail.py --dry-run
```

→ 41명 대상자 출력. 발송 X.

### 4-2. 본인 단일 테스트

```powershell
python scripts/send_kr_email_via_gmail.py --only-email sw.haka@gmail.com
```

→ Gmail 보낸편지함에서 `systemadmin@pronunfit.com` 주소로 받은 메일 확인.
→ Promotions 가는지 Inbox 가는지 검증.

### 4-3. 본인 + Apple ID 제외 후 전체 발송

본인 메일이 41명 리스트에 2개 포함됨 (Apple ID, Naver). 제외하려면:

```powershell
python scripts/send_kr_email_via_gmail.py --exclude-email pgz9qtwtpr@privaterelay.appleid.com s_w_ha@naver.com
```

→ 39명 발송 (실 사용자만). confirmation prompt 나옴.

### 4-4. 처음 N명만 (단계적 발송)

```powershell
python scripts/send_kr_email_via_gmail.py --limit 5
```

→ 처음 5명만 발송. 결과 보고 안전하면 다시 실행 (`freeTalkEmailSentAt` 마킹돼서 다음 5명부터 자동 시작).

## 5. 실행 후 모니터링

- **Gmail 보낸편지함** — 메일이 실제로 발송됐는지 확인
- **Firestore users 컬렉션** — 발송된 유저의 `freeTalkEmailSentAt` 필드 set 확인
- 일부 수신자에게 직접 도착 확인 요청 (지인/테스트 계정)

## 6. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `SMTPAuthenticationError` | App Password 틀림 또는 2단계 인증 비활성 | 비밀번호 재발급 |
| `Less Secure Apps` 에러 | (구식 — 최신 Gmail은 App Password가 표준) | App Password 사용 |
| `5.5.1 Daily user sending quota exceeded` | Gmail 500/일 한도 초과 | 다음날 재시도 (현재 41명은 한도 안에 듬) |
| `Cannot find module 'firebase_admin'` | pip install 누락 | `pip install firebase-admin` |
| 메일이 Promotions 탭으로 감 | Gmail ML 분류 (Send-as라도 100% 보장 X) | 1차 결과 확인 후 다음 캠페인은 카피 조정 |

## 7. 캠페인 후 정리

발송 완료 후:
- `firebase-key.json` 파일은 안전한 위치 보관 (다음 캠페인 재사용)
- 또는 발급 즉시 삭제 + 다음에 재발급 (보안 강화)
- App Password 는 그대로 유지 (다음 캠페인 재사용 가능)

## 보안 체크리스트

- [ ] `firebase-key.json` 이 git 디렉토리(`c:/Projects/multi-translator/`) 외부에 있음
- [ ] `GMAIL_APP_PASSWORD` 환경변수만 사용 (스크립트 hardcode 없음)
- [ ] chat·screenshot·문서에 비밀번호/JSON 평문 미공유
- [ ] 스크립트(`send_kr_email_via_gmail.py`) 자체는 비밀 정보 없음 → git commit OK
