"""
Free Talk 한국어 이메일 캠페인 — Gmail "Send as" 발송 스크립트

목적: KR lapsed 41명에게 Resend 대신 Gmail SMTP "Send as" 로 발송하여
      Promotions 탭이 아닌 Inbox 도달율 향상 시도.

발신자: PronunFit System Administrator <systemadmin@pronunfit.com>
        (실제 발송은 본인 Gmail 계정 sw.haka@gmail.com via "Send as" alias)

사용법:
  1. 환경변수 설정 (Windows PowerShell):
     $env:GMAIL_APP_PASSWORD = "xxxx xxxx xxxx xxxx"
     $env:FIREBASE_SERVICE_ACCOUNT = "C:\\private\\firebase-key.json"

  2. 의존성:
     pip install firebase-admin

  3. dryRun (발송 없이 대상자 출력):
     python scripts/send_kr_email_via_gmail.py --dry-run

  4. 본인에게만 테스트:
     python scripts/send_kr_email_via_gmail.py --only-email sw.haka@gmail.com

  5. 본인 + Apple ID 제외 + 전체 발송:
     python scripts/send_kr_email_via_gmail.py --exclude-email pgz9qtwtpr@privaterelay.appleid.com s_w_ha@naver.com

  6. 처음 3명만 (소량 테스트):
     python scripts/send_kr_email_via_gmail.py --limit 3

보안:
  - GMAIL_APP_PASSWORD 와 Firebase JSON 은 환경변수/파일 경로로만 전달
  - 스크립트 자체는 비밀 정보 미포함 → git commit 안전
  - .gitignore 처리 불필요 (환경변수 의존)

idempotency:
  - Firestore freeTalkEmailSentAt 마킹 → 재실행 시 이미 발송된 유저 자동 skip
  - 단, --only-email / 단일 테스트 시는 idempotency 우회

Throttling:
  - 발송 간 3초 sleep — Gmail rate limit (~ 100건/분 권장) 회피
  - 41명 = ~2분 소요
"""

import argparse
import os
import smtplib
import sys
import time
from datetime import datetime, timedelta, timezone
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

import firebase_admin
from firebase_admin import credentials, firestore

# ─── 설정 ─────────────────────────────────────────────────
GMAIL_USER = "sw.haka@gmail.com"          # 본인 Gmail
SEND_AS_NAME = "PronunFit System Administrator"
SEND_AS_EMAIL = "systemadmin@pronunfit.com"
REPLY_TO = "systemadmin@pronunfit.com"

PRIVACY_URL = "https://pronunfit.com/privacy"
PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.arigems.pronunfit"
UNSUBSCRIBE_BASE = "https://multitranslator.onrender.com/api/unsubscribe-email"

THROTTLE_SECONDS = 3       # 발송 간 대기 (Gmail rate limit 회피)
LAPSED_DAYS = 3            # 비활성 기준
COUNTRY = "KR"
CAMPAIGN_TAG = "free-talk-kr-2026-05-05-gmail"

SCREENSHOT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public", "email-assets", "free-talk-ko.jpg"
)
SCREENSHOT_CID = "free-talk-screenshot"
SUBJECT = "🎙️ Free Talk: AI와 진짜 대화하기 — PronunFit 신기능"


# ─── HTML 템플릿 (server/utils/sendEmail.js 의 renderFreeTalkEmailKO 와 동일) ─
def render_html_korean(name: str, unsub_link: str) -> str:
    safe_name = (name or "").replace("<", "").replace(">", "")
    greeting = f"안녕하세요 {safe_name}님!" if safe_name else "안녕하세요!"
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free Talk가 출시됐어요 — PronunFit</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Malgun Gothic',Helvetica,Arial,sans-serif;color:#1e293b;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
      <tr><td style="padding:28px 28px 8px 28px;text-align:center;">
        <div style="font-size:1.6rem;font-weight:800;color:#7B2D8E;letter-spacing:-0.5px;">PronunFit</div>
        <div style="font-size:0.85rem;color:#94a3b8;margin-top:4px;">AI로 똑똑하게 발음 학습</div>
      </td></tr>

      <tr><td style="padding:8px 28px 16px 28px;">
        <h1 style="margin:16px 0 8px 0;font-size:1.5rem;line-height:1.3;color:#1e293b;font-weight:800;text-align:center;">
          🎙️ Free Talk가 출시됐어요!
        </h1>
        <p style="margin:0;color:#64748b;font-size:0.95rem;text-align:center;line-height:1.5;">
          신기능 — AI와 자유롭게 대화하면서 발음 연습
        </p>
      </td></tr>

      <tr><td style="padding:8px 28px;text-align:center;">
        <img src="cid:{SCREENSHOT_CID}" alt="Free Talk demo screenshot" width="280"
             style="max-width:280px;width:100%;height:auto;border-radius:12px;border:1px solid #e2e8f0;display:block;margin:0 auto;">
      </td></tr>

      <tr><td style="padding:24px 28px 8px 28px;">
        <p style="margin:0 0 12px 0;font-size:1rem;color:#1e293b;">
          {greeting}
        </p>
        <p style="margin:0;font-size:0.95rem;color:#475569;line-height:1.6;">
          PronunFit 기억하시나요? 좋은 소식이 있어 알려드립니다. 한 번쯤 시도해보실 만한 <strong>Free-Talking 기능</strong>이 출시됐습니다.
        </p>
      </td></tr>

      <tr><td style="padding:16px 28px 8px 28px;">
        <h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">
          🌟 Free-Talking 기능이 뭔가요?
        </h2>
        <p style="margin:0 0 12px 0;font-size:0.92rem;color:#475569;line-height:1.6;">
          정해진 Q&amp;A 형식과 달리, Free Talk는 진짜 대화처럼:
        </p>
        <ul style="margin:0;padding-left:20px;color:#475569;font-size:0.92rem;line-height:1.8;">
          <li>✨ <strong>AI와 자연스럽게 대화</strong> — 외국인 친구와 이야기하듯</li>
          <li>🎯 <strong>실제 상황 시나리오</strong> — 카페·호텔·공항·기차 안...</li>
          <li>🗣️ <strong>대화당 8턴</strong> — 충분한 회화 연습 시간</li>
          <li>⚡ <strong>즉각 발음 피드백</strong> — 점수 바로 확인</li>
        </ul>
      </td></tr>

      <tr><td style="padding:16px 28px 8px 28px;">
        <h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">
          🎬 준비된 시나리오 예시
        </h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:0.92rem;color:#475569;">
          <tr><td style="padding:4px 0;">🚄 신칸센 안 — 옆자리 승객과 인사 나누기</td></tr>
          <tr><td style="padding:4px 0;">☕ 카페 — 좋아하는 음료 주문하기</td></tr>
          <tr><td style="padding:4px 0;">✈️ 공항 — 체크인 수속 밟기</td></tr>
          <tr><td style="padding:4px 0;">🏨 호텔 — 체크인 + 서비스 요청</td></tr>
          <tr><td style="padding:4px 0;">🛒 쇼핑 — 가격 묻고 흥정하기</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">... 그 외 다양한 상황!</td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:20px 28px 8px 28px;text-align:center;">
        <div style="display:inline-block;padding:8px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:24px;color:#166534;font-size:0.88rem;font-weight:600;">
          💛 완전 무료 — 매일 학습 카드 10장 제공
        </div>
      </td></tr>

      <tr><td style="padding:24px 28px;text-align:center;">
        <a href="{PLAY_STORE_URL}"
           style="display:inline-block;padding:16px 32px;background:#7B2D8E;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:1.05rem;letter-spacing:0.2px;">
          🚀 지금 Free Talk 시작하기
        </a>
        <p style="margin:12px 0 0 0;font-size:0.82rem;color:#94a3b8;line-height:1.5;">
          앱 열기 → 사이드바 "Free-Talking" 탭 → 상황/장소 설정 → "Free Talking" 버튼
        </p>
      </td></tr>

      <tr><td style="padding:8px 28px 28px 28px;border-top:1px solid #e2e8f0;margin-top:16px;">
        <p style="margin:16px 0 4px 0;font-size:0.92rem;color:#475569;line-height:1.6;">
          PronunFit과 함께해주셔서 감사합니다. 다시 만나길 기다리고 있어요!
        </p>
        <p style="margin:0;font-size:0.92rem;color:#475569;font-weight:600;">
          — PronunFit 팀
        </p>
      </td></tr>

      <tr><td style="padding:16px 28px 24px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
        <p style="margin:0 0 8px 0;font-size:0.78rem;color:#94a3b8;line-height:1.6;">
          PronunFit — AI로 똑똑하게 발음 학습<br>
          🌐 <a href="https://pronunfit.com" style="color:#94a3b8;text-decoration:underline;">pronunfit.com</a>
          &nbsp;·&nbsp;
          ✉️ <a href="mailto:{REPLY_TO}" style="color:#94a3b8;text-decoration:underline;">{REPLY_TO}</a>
        </p>
        <p style="margin:8px 0 0 0;font-size:0.74rem;color:#cbd5e1;line-height:1.6;">
          PronunFit 계정 가입자에게 발송된 서비스 알림 메일입니다.
          <br>
          <a href="{unsub_link}" style="color:#94a3b8;text-decoration:underline;">수신 거부</a>
          &nbsp;·&nbsp;
          <a href="{PRIVACY_URL}" style="color:#94a3b8;text-decoration:underline;">개인정보 처리방침</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""


def render_text_korean(name: str, unsub_link: str) -> str:
    greeting = f"안녕하세요 {name}님!" if name else "안녕하세요!"
    return f"""{greeting}

🎙️ Free Talk가 출시됐어요!

PronunFit 기억하시나요? 한 번쯤 시도해보실 만한 Free-Talking 기능이 출시됐습니다.

🌟 Free-Talking 기능이 뭔가요?

✨ AI와 자연스럽게 대화 — 외국인 친구와 이야기하듯
🎯 실제 상황 시나리오 — 카페·호텔·공항·기차 안...
🗣️ 대화당 8턴 — 충분한 회화 연습
⚡ 즉각 발음 피드백 — 점수 바로 확인

🎬 준비된 시나리오 예시:
🚄 신칸센 안
☕ 카페
✈️ 공항
🏨 호텔
🛒 쇼핑
... 그 외 다양한 상황!

💛 완전 무료 — 매일 학습 카드 10장.

🚀 지금 Free Talk 시작하기:
{PLAY_STORE_URL}

앱 열기 → 사이드바 "Free-Talking" 탭 → 상황/장소 설정 → "Free Talking" 버튼

—

PronunFit과 함께해주셔서 감사합니다. 다시 만나길 기다리고 있어요!
— PronunFit 팀

PronunFit — AI로 똑똑하게 발음 학습
https://pronunfit.com
{REPLY_TO}

---
PronunFit 계정 가입자에게 발송된 서비스 알림 메일입니다.
수신 거부: {unsub_link}
"""


# ─── 메인 ─────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Free Talk 한국어 이메일 캠페인 (Gmail Send-as)")
    parser.add_argument("--dry-run", action="store_true", help="발송 없이 대상자 리스트만 출력")
    parser.add_argument("--only-email", type=str, help="단일 이메일에만 발송 (테스트)")
    parser.add_argument("--exclude-email", nargs="+", default=[], help="제외할 이메일 (여러 개 가능)")
    parser.add_argument("--limit", type=int, help="최대 발송 수 (소량 테스트)")
    parser.add_argument("--throttle", type=int, default=THROTTLE_SECONDS, help="발송 간 대기 초 (default 3)")
    args = parser.parse_args()

    # 환경변수 확인
    gmail_password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    firebase_key = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()

    if not gmail_password:
        print("❌ ERROR: GMAIL_APP_PASSWORD 환경변수 미설정")
        sys.exit(1)
    if not firebase_key or not os.path.exists(firebase_key):
        print(f"❌ ERROR: FIREBASE_SERVICE_ACCOUNT not found: {firebase_key!r}")
        sys.exit(1)
    if not os.path.exists(SCREENSHOT_PATH):
        print(f"❌ ERROR: 이미지 미존재: {SCREENSHOT_PATH}")
        sys.exit(1)

    # 이미지 로드
    with open(SCREENSHOT_PATH, "rb") as f:
        img_data = f.read()
    print(f"📷 이미지 로드: {len(img_data):,} bytes")

    # Firestore 초기화
    cred = credentials.Certificate(firebase_key)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print(f"🔥 Firestore 연결됨")

    # 후보 조회
    lapsed_threshold = datetime.now(timezone.utc) - timedelta(days=LAPSED_DAYS)
    exclude_set = {e.lower() for e in args.exclude_email}
    only_email = args.only_email.lower() if args.only_email else None

    recipients = []
    print(f"🔍 KR lapsed 후보 조회 중...")
    docs = db.collection("users").stream()
    for doc in docs:
        d = doc.to_dict()
        if (d.get("geoCountry") or "").upper() != COUNTRY:
            continue
        email = (d.get("email") or "").strip()
        if not email:
            continue
        if only_email and email.lower() != only_email:
            continue
        if email.lower() in exclude_set:
            continue
        # lapsed (only_email 시 우회)
        upd = d.get("updatedAt")
        if not only_email and upd and upd >= lapsed_threshold:
            continue
        # opt-out
        if d.get("emailOptOut") is True:
            continue
        if d.get("tier") == "admin":
            continue
        # idempotency (only_email 시 우회)
        if not only_email and d.get("freeTalkEmailSentAt"):
            continue
        # D0 신규 (only_email 시 우회)
        created = d.get("createdAt")
        if not only_email and created:
            age = (datetime.now(timezone.utc) - created).total_seconds()
            if age < 24 * 3600:
                continue

        recipients.append({
            "uid": doc.id,
            "email": email,
            "name": d.get("displayName") or "",
        })
        if args.limit and len(recipients) >= args.limit:
            break

    print(f"\n✅ 발송 대상: {len(recipients)} 명")
    if exclude_set:
        print(f"   제외: {len(exclude_set)} 개 이메일")

    if args.dry_run:
        print("\n[DRY RUN] 대상자 리스트:")
        for i, r in enumerate(recipients, 1):
            print(f"  {i:3}. {r['name'] or '(no name)':25} {r['email']}")
        return

    # 발송 confirmation
    if not only_email:
        print(f"\n⚠️  실 발송 시작 — {len(recipients)}명에게 메일 발송합니다.")
        print(f"   throttle: {args.throttle}초/메일 → 예상 소요: ~{args.throttle * len(recipients) / 60:.1f}분")
        confirm = input("   계속하시겠습니까? [y/N]: ").strip().lower()
        if confirm != "y":
            print("취소됨.")
            return

    # SMTP 연결
    print(f"\n📤 Gmail SMTP 연결 ({GMAIL_USER})...")
    smtp = smtplib.SMTP_SSL("smtp.gmail.com", 465)
    smtp.login(GMAIL_USER, gmail_password)
    print("   연결 OK ✓")

    sent_count = 0
    failed = []

    for i, r in enumerate(recipients):
        try:
            unsub_url = f"{UNSUBSCRIBE_BASE}?uid={r['uid']}"

            # MIME 구성: multipart/related (HTML + inline image)
            msg = MIMEMultipart("related")
            msg["From"] = formataddr((SEND_AS_NAME, SEND_AS_EMAIL))
            msg["To"] = r["email"]
            msg["Subject"] = SUBJECT
            msg["Reply-To"] = REPLY_TO
            msg["List-Unsubscribe"] = f"<{unsub_url}>"
            msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

            # multipart/alternative (text + html)
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(render_text_korean(r["name"], unsub_url), "plain", "utf-8"))
            alt.attach(MIMEText(render_html_korean(r["name"], unsub_url), "html", "utf-8"))
            msg.attach(alt)

            # Inline 이미지 (cid 참조)
            img = MIMEImage(img_data, _subtype="jpeg")
            img.add_header("Content-ID", f"<{SCREENSHOT_CID}>")
            img.add_header("Content-Disposition", "inline", filename="free-talk-ko.jpg")
            msg.attach(img)

            # 발송 (envelope from = GMAIL_USER, header from = SEND_AS_EMAIL)
            smtp.sendmail(GMAIL_USER, [r["email"]], msg.as_string())

            # Firestore 마킹
            db.collection("users").document(r["uid"]).update({
                "freeTalkEmailSentAt": firestore.SERVER_TIMESTAMP,
                "freeTalkEmailVia": "gmail-sendas",
                "freeTalkEmailCampaign": CAMPAIGN_TAG,
            })

            sent_count += 1
            print(f"  [{i+1}/{len(recipients)}] ✅ {r['email']}")

            # Throttle
            if i < len(recipients) - 1:
                time.sleep(args.throttle)
        except Exception as e:
            failed.append({"email": r["email"], "error": str(e)})
            print(f"  [{i+1}/{len(recipients)}] ❌ {r['email']}: {e}")

    smtp.quit()
    print(f"\n📊 결과")
    print(f"   ✅ 발송 성공: {sent_count}/{len(recipients)}")
    if failed:
        print(f"   ❌ 실패: {len(failed)}")
        for f in failed:
            print(f"      {f['email']}: {f['error']}")


if __name__ == "__main__":
    main()
