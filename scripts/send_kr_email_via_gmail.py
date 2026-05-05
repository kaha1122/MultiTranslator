"""
Free-Talking 이메일 캠페인 — Gmail "Send as" 발송 스크립트 (멀티언어)

목적: lapsed 유저를 sourceLang 기준으로 필터링 + 해당 언어 카피로 발송.
       Resend 대비 Primary Inbox 도달율 개선 (KR 본인 검증 완료).

지원 언어 (sourceLang 기준):
  - ko (한국어) — 기존 KR 캠페인
  - vi (베트남어) — 기존 VN 캠페인 (필요 시)
  - en (영어)
  - ru (러시아어)
  - es (스페인어)

발신자: PronunFit System Administrator <systemadmin@pronunfit.com>
        (실제 발송은 본인 Gmail 계정 sw.haka@gmail.com via "Send as" alias)

이미지: 모든 언어 동일하게 public/email-assets/free-talk-ko.jpg 사용
        (사용자 요청 — 한국어 UI 스크린샷이 컨셉 전달에 충분)

사용법:
  1. 환경변수 (Windows PowerShell):
     $env:GMAIL_APP_PASSWORD = "xxxx xxxx xxxx xxxx"
     $env:FIREBASE_SERVICE_ACCOUNT = "C:\\private\\firebase-key.json"

  2. 의존성:
     pip install firebase-admin

  3. dryRun (대상자 출력만):
     python scripts/send_kr_email_via_gmail.py --lang en --dry-run

  4. 본인 단일 테스트:
     python scripts/send_kr_email_via_gmail.py --lang en --only-email sw.haka@gmail.com

  5. 전체 발송:
     python scripts/send_kr_email_via_gmail.py --lang ru
     python scripts/send_kr_email_via_gmail.py --lang es

  6. 본인 메일 제외 + 전체:
     python scripts/send_kr_email_via_gmail.py --lang en --exclude-email pgz9qtwtpr@privaterelay.appleid.com s_w_ha@naver.com

idempotency:
  - Firestore freeTalkEmailSentAt 마킹 → 재실행 시 이미 발송된 유저 자동 skip
  - --only-email 시는 idempotency 우회 (테스트용)
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

# Windows cp949 console에서도 한글/이모지 print 가능하도록 stdout/stderr UTF-8 강제
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, Exception):
    pass

import firebase_admin
from firebase_admin import credentials, firestore

# ─── 발신자 / 공통 설정 ─────────────────────────────────────────
GMAIL_USER = "sw.haka@gmail.com"
SEND_AS_NAME = "PronunFit System Administrator"
SEND_AS_EMAIL = "systemadmin@pronunfit.com"
REPLY_TO = "systemadmin@pronunfit.com"

PRIVACY_URL = "https://pronunfit.com/privacy"
PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.arigems.pronunfit"
UNSUBSCRIBE_BASE = "https://multitranslator.onrender.com/api/unsubscribe-email"

THROTTLE_SECONDS = 3
LAPSED_DAYS = 3

# 모든 언어 동일 이미지 (사용자 요청 — 한국어 UI 스크린샷)
SCREENSHOT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public", "email-assets", "free-talk-ko.jpg"
)
SCREENSHOT_CID = "free-talk-screenshot"


# ─── 한국어 (ko) 템플릿 ──────────────────────────────────────────
def render_html_ko(name, unsub_link):
    safe_name = (name or "").replace("<", "").replace(">", "")
    greeting = f"안녕하세요 {safe_name}님!" if safe_name else "안녕하세요!"
    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Free-Talking — PronunFit</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Malgun Gothic',Helvetica,Arial,sans-serif;color:#1e293b;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
<tr><td style="padding:28px 28px 8px 28px;text-align:center;"><div style="font-size:1.6rem;font-weight:800;color:#7B2D8E;letter-spacing:-0.5px;">PronunFit</div><div style="font-size:0.85rem;color:#94a3b8;margin-top:4px;">AI로 똑똑하게 발음 학습</div></td></tr>
<tr><td style="padding:8px 28px 16px 28px;"><h1 style="margin:16px 0 8px 0;font-size:1.5rem;line-height:1.3;color:#1e293b;font-weight:800;text-align:center;">🎙️ Free-Talking기능이 출시됐어요!</h1><p style="margin:0;color:#64748b;font-size:0.95rem;text-align:center;line-height:1.5;">신기능 — AI와 실시간 Free Talking하면서 실전대화 연습</p></td></tr>
<tr><td style="padding:8px 28px;text-align:center;"><img src="cid:{SCREENSHOT_CID}" alt="Free Talk demo screenshot" width="280" style="max-width:280px;width:100%;height:auto;border-radius:12px;border:1px solid #e2e8f0;display:block;margin:0 auto;"></td></tr>
<tr><td style="padding:24px 28px 8px 28px;"><p style="margin:0 0 12px 0;font-size:1rem;color:#1e293b;">{greeting}</p><p style="margin:0;font-size:0.95rem;color:#475569;line-height:1.6;">PronunFit 기억하시나요? 좋은 소식이 있어 알려드립니다. 한 번쯤 시도해보실 만한 <strong>Free-Talking 기능</strong>이 출시됐습니다.</p></td></tr>
<tr><td style="padding:16px 28px 8px 28px;"><h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">🌟 Free-Talking 기능이 뭔가요?</h2><p style="margin:0 0 12px 0;font-size:0.92rem;color:#475569;line-height:1.6;">정해진 Q&amp;A 형식과 달리, Free Talk는 진짜 대화처럼:</p><ul style="margin:0;padding-left:20px;color:#475569;font-size:0.92rem;line-height:1.8;"><li>✨ <strong>AI와 자연스럽게 대화</strong> — 외국인 친구와 이야기하듯</li><li>🎯 <strong>실제 상황 시나리오</strong> — 카페·호텔·공항·기차 안...</li><li>🗣️ <strong>대화당 8턴</strong> — 충분한 회화 연습 시간</li><li>⚡ <strong>즉각 발음 피드백</strong> — 점수 바로 확인</li></ul></td></tr>
<tr><td style="padding:16px 28px 8px 28px;"><h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">🎬 준비된 시나리오 예시</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:0.92rem;color:#475569;"><tr><td style="padding:4px 0;">🚄 신칸센 안 — 옆자리 승객과 인사 나누기</td></tr><tr><td style="padding:4px 0;">☕ 카페 — 좋아하는 음료 주문하기</td></tr><tr><td style="padding:4px 0;">✈️ 공항 — 체크인 수속 밟기</td></tr><tr><td style="padding:4px 0;">🏨 호텔 — 체크인 + 서비스 요청</td></tr><tr><td style="padding:4px 0;">🛒 쇼핑 — 가격 묻고 흥정하기</td></tr><tr><td style="padding:4px 0;color:#94a3b8;">... 그 외 다양한 상황!</td></tr></table></td></tr>
<tr><td style="padding:20px 28px 8px 28px;text-align:center;"><div style="display:inline-block;padding:8px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:24px;color:#166534;font-size:0.88rem;font-weight:600;">💛 완전 무료 — 매일 학습 카드 10장 제공</div></td></tr>
<tr><td style="padding:24px 28px;text-align:center;"><a href="{PLAY_STORE_URL}" style="display:inline-block;padding:16px 32px;background:#7B2D8E;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:1.05rem;letter-spacing:0.2px;">🚀 지금 Free Talk 시작하기</a><p style="margin:12px 0 0 0;font-size:0.82rem;color:#94a3b8;line-height:1.5;">앱 열기 → 사이드바 "Free-Talking" 탭 → 상황/장소 설정 → "Free Talking" 버튼</p></td></tr>
<tr><td style="padding:8px 28px 28px 28px;border-top:1px solid #e2e8f0;margin-top:16px;"><p style="margin:16px 0 4px 0;font-size:0.92rem;color:#475569;line-height:1.6;">PronunFit과 함께해주셔서 감사합니다. 다시 만나길 기다리고 있어요!</p><p style="margin:0;font-size:0.92rem;color:#475569;font-weight:600;">— PronunFit 팀</p></td></tr>
<tr><td style="padding:16px 28px 24px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;"><p style="margin:0 0 8px 0;font-size:0.78rem;color:#94a3b8;line-height:1.6;">PronunFit — AI로 똑똑하게 발음 학습<br>🌐 <a href="https://pronunfit.com" style="color:#94a3b8;text-decoration:underline;">pronunfit.com</a> &nbsp;·&nbsp; ✉️ <a href="mailto:{REPLY_TO}" style="color:#94a3b8;text-decoration:underline;">{REPLY_TO}</a></p><p style="margin:8px 0 0 0;font-size:0.74rem;color:#cbd5e1;line-height:1.6;">PronunFit 계정 가입자에게 발송된 서비스 알림 메일입니다.<br><a href="{unsub_link}" style="color:#94a3b8;text-decoration:underline;">수신 거부</a> &nbsp;·&nbsp; <a href="{PRIVACY_URL}" style="color:#94a3b8;text-decoration:underline;">개인정보 처리방침</a></p></td></tr>
</table></td></tr></table></body></html>"""


def render_text_ko(name, unsub_link):
    greeting = f"안녕하세요 {name}님!" if name else "안녕하세요!"
    return f"""{greeting}

🎙️ Free-Talking기능이 출시됐어요!

PronunFit 기억하시나요? 한 번쯤 시도해보실 만한 Free-Talking 기능이 출시됐습니다.

🌟 Free-Talking 기능이 뭔가요?
✨ AI와 자연스럽게 대화 — 외국인 친구와 이야기하듯
🎯 실제 상황 시나리오 — 카페·호텔·공항·기차 안...
🗣️ 대화당 8턴 — 충분한 회화 연습
⚡ 즉각 발음 피드백 — 점수 바로 확인

🎬 준비된 시나리오 예시:
🚄 신칸센 안 / ☕ 카페 / ✈️ 공항 / 🏨 호텔 / 🛒 쇼핑 ...

💛 완전 무료 — 매일 학습 카드 10장.

🚀 지금 Free Talk 시작하기: {PLAY_STORE_URL}
앱 열기 → 사이드바 "Free-Talking" 탭 → 상황/장소 설정 → "Free Talking" 버튼

— PronunFit 팀
https://pronunfit.com / {REPLY_TO}

---
PronunFit 계정 가입자에게 발송된 서비스 알림 메일입니다.
수신 거부: {unsub_link}
"""


# ─── 영어 (en) 템플릿 ──────────────────────────────────────────
def render_html_en(name, unsub_link):
    safe_name = (name or "").replace("<", "").replace(">", "")
    greeting = f"Hello {safe_name}!" if safe_name else "Hello!"
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Free-Talking — PronunFit</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
<tr><td style="padding:28px 28px 8px 28px;text-align:center;"><div style="font-size:1.6rem;font-weight:800;color:#7B2D8E;letter-spacing:-0.5px;">PronunFit</div><div style="font-size:0.85rem;color:#94a3b8;margin-top:4px;">Smart AI pronunciation practice</div></td></tr>
<tr><td style="padding:8px 28px 16px 28px;"><h1 style="margin:16px 0 8px 0;font-size:1.5rem;line-height:1.3;color:#1e293b;font-weight:800;text-align:center;">🎙️ Free-Talking is here!</h1><p style="margin:0;color:#64748b;font-size:0.95rem;text-align:center;line-height:1.5;">New feature — practice real conversations with AI in real time</p></td></tr>
<tr><td style="padding:8px 28px;text-align:center;"><img src="cid:{SCREENSHOT_CID}" alt="Free Talk demo screenshot" width="280" style="max-width:280px;width:100%;height:auto;border-radius:12px;border:1px solid #e2e8f0;display:block;margin:0 auto;"></td></tr>
<tr><td style="padding:24px 28px 8px 28px;"><p style="margin:0 0 12px 0;font-size:1rem;color:#1e293b;">{greeting}</p><p style="margin:0;font-size:0.95rem;color:#475569;line-height:1.6;">Remember PronunFit? Great news to share — we've just launched <strong>Free-Talking</strong>, a feature you'll definitely want to try.</p></td></tr>
<tr><td style="padding:16px 28px 8px 28px;"><h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">🌟 What is Free-Talking?</h2><p style="margin:0 0 12px 0;font-size:0.92rem;color:#475569;line-height:1.6;">Unlike fixed Q&amp;A practice, Free-Talking lets you have real conversations:</p><ul style="margin:0;padding-left:20px;color:#475569;font-size:0.92rem;line-height:1.8;"><li>✨ <strong>Natural AI conversations</strong> — like talking with a friend abroad</li><li>🎯 <strong>Real-life scenarios</strong> — café, hotel, airport, train...</li><li>🗣️ <strong>8 turns per conversation</strong> — enough time to actually practice</li><li>⚡ <strong>Instant pronunciation feedback</strong> — see your score immediately</li></ul></td></tr>
<tr><td style="padding:16px 28px 8px 28px;"><h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">🎬 Ready-made scenarios</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:0.92rem;color:#475569;"><tr><td style="padding:4px 0;">🚄 On the Shinkansen — chat with a fellow passenger</td></tr><tr><td style="padding:4px 0;">☕ At a café — order your favorite drink</td></tr><tr><td style="padding:4px 0;">✈️ Airport — go through check-in</td></tr><tr><td style="padding:4px 0;">🏨 Hotel — check in and request services</td></tr><tr><td style="padding:4px 0;">🛒 Shopping — ask prices and bargain</td></tr><tr><td style="padding:4px 0;color:#94a3b8;">... and many more situations!</td></tr></table></td></tr>
<tr><td style="padding:20px 28px 8px 28px;text-align:center;"><div style="display:inline-block;padding:8px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:24px;color:#166534;font-size:0.88rem;font-weight:600;">💛 Completely free — 10 study cards per day</div></td></tr>
<tr><td style="padding:24px 28px;text-align:center;"><a href="{PLAY_STORE_URL}" style="display:inline-block;padding:16px 32px;background:#7B2D8E;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:1.05rem;letter-spacing:0.2px;">🚀 Try Free-Talking now</a><p style="margin:12px 0 0 0;font-size:0.82rem;color:#94a3b8;line-height:1.5;">Open the app → "Free-Talking" tab in sidebar → choose scene → tap "Free Talking" button</p></td></tr>
<tr><td style="padding:8px 28px 28px 28px;border-top:1px solid #e2e8f0;margin-top:16px;"><p style="margin:16px 0 4px 0;font-size:0.92rem;color:#475569;line-height:1.6;">Thank you for being with PronunFit. We hope to see you back!</p><p style="margin:0;font-size:0.92rem;color:#475569;font-weight:600;">— The PronunFit Team</p></td></tr>
<tr><td style="padding:16px 28px 24px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;"><p style="margin:0 0 8px 0;font-size:0.78rem;color:#94a3b8;line-height:1.6;">PronunFit — Smart AI pronunciation practice<br>🌐 <a href="https://pronunfit.com" style="color:#94a3b8;text-decoration:underline;">pronunfit.com</a> &nbsp;·&nbsp; ✉️ <a href="mailto:{REPLY_TO}" style="color:#94a3b8;text-decoration:underline;">{REPLY_TO}</a></p><p style="margin:8px 0 0 0;font-size:0.74rem;color:#cbd5e1;line-height:1.6;">You're receiving this email because you signed up for PronunFit. This is a service notification about a new feature.<br><a href="{unsub_link}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a> &nbsp;·&nbsp; <a href="{PRIVACY_URL}" style="color:#94a3b8;text-decoration:underline;">Privacy Policy</a></p></td></tr>
</table></td></tr></table></body></html>"""


def render_text_en(name, unsub_link):
    greeting = f"Hello {name}!" if name else "Hello!"
    return f"""{greeting}

🎙️ Free-Talking is here!

Remember PronunFit? Great news to share — we've just launched Free-Talking, a feature you'll definitely want to try.

🌟 What is Free-Talking?
✨ Natural AI conversations — like talking with a friend abroad
🎯 Real-life scenarios — café, hotel, airport, train...
🗣️ 8 turns per conversation — enough time to actually practice
⚡ Instant pronunciation feedback — see your score immediately

🎬 Ready-made scenarios:
🚄 Shinkansen / ☕ Café / ✈️ Airport / 🏨 Hotel / 🛒 Shopping ...

💛 Completely free — 10 study cards per day.

🚀 Try Free-Talking now: {PLAY_STORE_URL}
Open the app → "Free-Talking" tab in sidebar → choose scene → tap "Free Talking" button

— The PronunFit Team
https://pronunfit.com / {REPLY_TO}

---
You're receiving this email because you signed up for PronunFit.
Unsubscribe: {unsub_link}
"""


# ─── 러시아어 (ru) 템플릿 ──────────────────────────────────────────
def render_html_ru(name, unsub_link):
    safe_name = (name or "").replace("<", "").replace(">", "")
    greeting = f"Здравствуйте, {safe_name}!" if safe_name else "Здравствуйте!"
    return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Free-Talking — PronunFit</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
<tr><td style="padding:28px 28px 8px 28px;text-align:center;"><div style="font-size:1.6rem;font-weight:800;color:#7B2D8E;letter-spacing:-0.5px;">PronunFit</div><div style="font-size:0.85rem;color:#94a3b8;margin-top:4px;">Умная практика произношения с ИИ</div></td></tr>
<tr><td style="padding:8px 28px 16px 28px;"><h1 style="margin:16px 0 8px 0;font-size:1.5rem;line-height:1.3;color:#1e293b;font-weight:800;text-align:center;">🎙️ Free-Talking уже доступен!</h1><p style="margin:0;color:#64748b;font-size:0.95rem;text-align:center;line-height:1.5;">Новая функция — практикуйте настоящие разговоры с ИИ в реальном времени</p></td></tr>
<tr><td style="padding:8px 28px;text-align:center;"><img src="cid:{SCREENSHOT_CID}" alt="Free Talk demo screenshot" width="280" style="max-width:280px;width:100%;height:auto;border-radius:12px;border:1px solid #e2e8f0;display:block;margin:0 auto;"></td></tr>
<tr><td style="padding:24px 28px 8px 28px;"><p style="margin:0 0 12px 0;font-size:1rem;color:#1e293b;">{greeting}</p><p style="margin:0;font-size:0.95rem;color:#475569;line-height:1.6;">Помните PronunFit? Отличные новости — мы только что выпустили <strong>Free-Talking</strong>, функцию, которую вы обязательно захотите попробовать.</p></td></tr>
<tr><td style="padding:16px 28px 8px 28px;"><h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">🌟 Что такое Free-Talking?</h2><p style="margin:0 0 12px 0;font-size:0.92rem;color:#475569;line-height:1.6;">В отличие от фиксированных вопросов и ответов, Free-Talking — это настоящие беседы:</p><ul style="margin:0;padding-left:20px;color:#475569;font-size:0.92rem;line-height:1.8;"><li>✨ <strong>Естественные разговоры с ИИ</strong> — как с другом-иностранцем</li><li>🎯 <strong>Реальные ситуации</strong> — кафе, отель, аэропорт, поезд...</li><li>🗣️ <strong>8 реплик в каждом диалоге</strong> — достаточно для практики</li><li>⚡ <strong>Мгновенная обратная связь</strong> — увидите оценку произношения сразу</li></ul></td></tr>
<tr><td style="padding:16px 28px 8px 28px;"><h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">🎬 Готовые сценарии</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:0.92rem;color:#475569;"><tr><td style="padding:4px 0;">🚄 В Синкансене — заговорить с соседним пассажиром</td></tr><tr><td style="padding:4px 0;">☕ В кафе — заказать любимый напиток</td></tr><tr><td style="padding:4px 0;">✈️ Аэропорт — пройти регистрацию</td></tr><tr><td style="padding:4px 0;">🏨 Отель — заселение и просьбы об услугах</td></tr><tr><td style="padding:4px 0;">🛒 Шопинг — спрашивать цены и торговаться</td></tr><tr><td style="padding:4px 0;color:#94a3b8;">... и многие другие ситуации!</td></tr></table></td></tr>
<tr><td style="padding:20px 28px 8px 28px;text-align:center;"><div style="display:inline-block;padding:8px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:24px;color:#166534;font-size:0.88rem;font-weight:600;">💛 Полностью бесплатно — 10 учебных карточек в день</div></td></tr>
<tr><td style="padding:24px 28px;text-align:center;"><a href="{PLAY_STORE_URL}" style="display:inline-block;padding:16px 32px;background:#7B2D8E;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:1.05rem;letter-spacing:0.2px;">🚀 Попробовать Free-Talking сейчас</a><p style="margin:12px 0 0 0;font-size:0.82rem;color:#94a3b8;line-height:1.5;">Откройте приложение → вкладка "Free-Talking" в боковом меню → выберите сцену → кнопка "Free Talking"</p></td></tr>
<tr><td style="padding:8px 28px 28px 28px;border-top:1px solid #e2e8f0;margin-top:16px;"><p style="margin:16px 0 4px 0;font-size:0.92rem;color:#475569;line-height:1.6;">Спасибо, что были с PronunFit. Будем рады снова видеть вас!</p><p style="margin:0;font-size:0.92rem;color:#475569;font-weight:600;">— Команда PronunFit</p></td></tr>
<tr><td style="padding:16px 28px 24px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;"><p style="margin:0 0 8px 0;font-size:0.78rem;color:#94a3b8;line-height:1.6;">PronunFit — Умная практика произношения с ИИ<br>🌐 <a href="https://pronunfit.com" style="color:#94a3b8;text-decoration:underline;">pronunfit.com</a> &nbsp;·&nbsp; ✉️ <a href="mailto:{REPLY_TO}" style="color:#94a3b8;text-decoration:underline;">{REPLY_TO}</a></p><p style="margin:8px 0 0 0;font-size:0.74rem;color:#cbd5e1;line-height:1.6;">Вы получили это письмо, потому что зарегистрировались в PronunFit. Это уведомление о новой функции сервиса.<br><a href="{unsub_link}" style="color:#94a3b8;text-decoration:underline;">Отписаться</a> &nbsp;·&nbsp; <a href="{PRIVACY_URL}" style="color:#94a3b8;text-decoration:underline;">Политика конфиденциальности</a></p></td></tr>
</table></td></tr></table></body></html>"""


def render_text_ru(name, unsub_link):
    greeting = f"Здравствуйте, {name}!" if name else "Здравствуйте!"
    return f"""{greeting}

🎙️ Free-Talking уже доступен!

Помните PronunFit? Отличные новости — мы только что выпустили Free-Talking, функцию, которую вы обязательно захотите попробовать.

🌟 Что такое Free-Talking?
✨ Естественные разговоры с ИИ — как с другом-иностранцем
🎯 Реальные ситуации — кафе, отель, аэропорт, поезд...
🗣️ 8 реплик в каждом диалоге — достаточно для практики
⚡ Мгновенная обратная связь по произношению

🎬 Готовые сценарии:
🚄 Синкансен / ☕ Кафе / ✈️ Аэропорт / 🏨 Отель / 🛒 Шопинг ...

💛 Полностью бесплатно — 10 карточек в день.

🚀 Попробовать сейчас: {PLAY_STORE_URL}
Откройте приложение → вкладка "Free-Talking" → сцена → кнопка "Free Talking"

— Команда PronunFit
https://pronunfit.com / {REPLY_TO}

---
Вы получили это письмо, потому что зарегистрировались в PronunFit.
Отписаться: {unsub_link}
"""


# ─── 스페인어 (es) 템플릿 ──────────────────────────────────────────
def render_html_es(name, unsub_link):
    safe_name = (name or "").replace("<", "").replace(">", "")
    greeting = f"¡Hola {safe_name}!" if safe_name else "¡Hola!"
    return f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Free-Talking — PronunFit</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
<tr><td style="padding:28px 28px 8px 28px;text-align:center;"><div style="font-size:1.6rem;font-weight:800;color:#7B2D8E;letter-spacing:-0.5px;">PronunFit</div><div style="font-size:0.85rem;color:#94a3b8;margin-top:4px;">Práctica inteligente de pronunciación con IA</div></td></tr>
<tr><td style="padding:8px 28px 16px 28px;"><h1 style="margin:16px 0 8px 0;font-size:1.5rem;line-height:1.3;color:#1e293b;font-weight:800;text-align:center;">🎙️ ¡Ya llegó Free-Talking!</h1><p style="margin:0;color:#64748b;font-size:0.95rem;text-align:center;line-height:1.5;">Nueva función — practica conversaciones reales con IA en tiempo real</p></td></tr>
<tr><td style="padding:8px 28px;text-align:center;"><img src="cid:{SCREENSHOT_CID}" alt="Free Talk demo screenshot" width="280" style="max-width:280px;width:100%;height:auto;border-radius:12px;border:1px solid #e2e8f0;display:block;margin:0 auto;"></td></tr>
<tr><td style="padding:24px 28px 8px 28px;"><p style="margin:0 0 12px 0;font-size:1rem;color:#1e293b;">{greeting}</p><p style="margin:0;font-size:0.95rem;color:#475569;line-height:1.6;">¿Recuerdas PronunFit? Tenemos buenas noticias — acabamos de lanzar <strong>Free-Talking</strong>, una función que sin duda querrás probar.</p></td></tr>
<tr><td style="padding:16px 28px 8px 28px;"><h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">🌟 ¿Qué es Free-Talking?</h2><p style="margin:0 0 12px 0;font-size:0.92rem;color:#475569;line-height:1.6;">A diferencia del formato fijo de preguntas y respuestas, Free-Talking te permite tener conversaciones reales:</p><ul style="margin:0;padding-left:20px;color:#475569;font-size:0.92rem;line-height:1.8;"><li>✨ <strong>Conversaciones naturales con la IA</strong> — como hablar con un amigo extranjero</li><li>🎯 <strong>Situaciones reales</strong> — café, hotel, aeropuerto, tren...</li><li>🗣️ <strong>8 turnos por conversación</strong> — tiempo suficiente para practicar</li><li>⚡ <strong>Retroalimentación instantánea</strong> — verás tu puntuación de pronunciación al momento</li></ul></td></tr>
<tr><td style="padding:16px 28px 8px 28px;"><h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">🎬 Escenarios disponibles</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:0.92rem;color:#475569;"><tr><td style="padding:4px 0;">🚄 En el Shinkansen — conversar con otro pasajero</td></tr><tr><td style="padding:4px 0;">☕ En la cafetería — pedir tu bebida favorita</td></tr><tr><td style="padding:4px 0;">✈️ Aeropuerto — hacer el check-in</td></tr><tr><td style="padding:4px 0;">🏨 Hotel — registrarte y pedir servicios</td></tr><tr><td style="padding:4px 0;">🛒 Compras — preguntar precios y regatear</td></tr><tr><td style="padding:4px 0;color:#94a3b8;">... ¡y muchas situaciones más!</td></tr></table></td></tr>
<tr><td style="padding:20px 28px 8px 28px;text-align:center;"><div style="display:inline-block;padding:8px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:24px;color:#166534;font-size:0.88rem;font-weight:600;">💛 Totalmente gratis — 10 tarjetas de estudio al día</div></td></tr>
<tr><td style="padding:24px 28px;text-align:center;"><a href="{PLAY_STORE_URL}" style="display:inline-block;padding:16px 32px;background:#7B2D8E;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:1.05rem;letter-spacing:0.2px;">🚀 Probar Free-Talking ahora</a><p style="margin:12px 0 0 0;font-size:0.82rem;color:#94a3b8;line-height:1.5;">Abrir la app → pestaña "Free-Talking" en barra lateral → elegir escena → botón "Free Talking"</p></td></tr>
<tr><td style="padding:8px 28px 28px 28px;border-top:1px solid #e2e8f0;margin-top:16px;"><p style="margin:16px 0 4px 0;font-size:0.92rem;color:#475569;line-height:1.6;">Gracias por estar con PronunFit. ¡Esperamos verte pronto!</p><p style="margin:0;font-size:0.92rem;color:#475569;font-weight:600;">— El equipo de PronunFit</p></td></tr>
<tr><td style="padding:16px 28px 24px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;"><p style="margin:0 0 8px 0;font-size:0.78rem;color:#94a3b8;line-height:1.6;">PronunFit — Práctica inteligente de pronunciación con IA<br>🌐 <a href="https://pronunfit.com" style="color:#94a3b8;text-decoration:underline;">pronunfit.com</a> &nbsp;·&nbsp; ✉️ <a href="mailto:{REPLY_TO}" style="color:#94a3b8;text-decoration:underline;">{REPLY_TO}</a></p><p style="margin:8px 0 0 0;font-size:0.74rem;color:#cbd5e1;line-height:1.6;">Recibes este correo porque te registraste en PronunFit. Es una notificación de servicio sobre una nueva función.<br><a href="{unsub_link}" style="color:#94a3b8;text-decoration:underline;">Cancelar suscripción</a> &nbsp;·&nbsp; <a href="{PRIVACY_URL}" style="color:#94a3b8;text-decoration:underline;">Política de privacidad</a></p></td></tr>
</table></td></tr></table></body></html>"""


def render_text_es(name, unsub_link):
    greeting = f"¡Hola {name}!" if name else "¡Hola!"
    return f"""{greeting}

🎙️ ¡Ya llegó Free-Talking!

¿Recuerdas PronunFit? Tenemos buenas noticias — acabamos de lanzar Free-Talking, una función que sin duda querrás probar.

🌟 ¿Qué es Free-Talking?
✨ Conversaciones naturales con la IA — como hablar con un amigo extranjero
🎯 Situaciones reales — café, hotel, aeropuerto, tren...
🗣️ 8 turnos por conversación — tiempo suficiente para practicar
⚡ Retroalimentación instantánea de pronunciación

🎬 Escenarios disponibles:
🚄 Shinkansen / ☕ Café / ✈️ Aeropuerto / 🏨 Hotel / 🛒 Compras ...

💛 Totalmente gratis — 10 tarjetas al día.

🚀 Probar ahora: {PLAY_STORE_URL}
Abrir la app → "Free-Talking" → elegir escena → botón "Free Talking"

— El equipo de PronunFit
https://pronunfit.com / {REPLY_TO}

---
Recibes este correo porque te registraste en PronunFit.
Cancelar suscripción: {unsub_link}
"""


# ─── 언어별 설정 매핑 ──────────────────────────────────────────────
LANG_CONFIGS = {
    'ko': {
        'subject': '🎙️ Free-Talking: AI와 진짜 대화하기 — PronunFit 신기능',
        'render_html': render_html_ko,
        'render_text': render_text_ko,
        'campaign': 'free-talk-kr-2026-05-05-gmail',
    },
    'en': {
        'subject': '🎙️ Free-Talking: real conversations with AI — PronunFit new feature',
        'render_html': render_html_en,
        'render_text': render_text_en,
        'campaign': 'free-talk-en-2026-05-05-gmail',
    },
    'ru': {
        'subject': '🎙️ Free-Talking: настоящие разговоры с ИИ — новая функция PronunFit',
        'render_html': render_html_ru,
        'render_text': render_text_ru,
        'campaign': 'free-talk-ru-2026-05-05-gmail',
    },
    'es': {
        'subject': '🎙️ Free-Talking: conversaciones reales con IA — nueva función de PronunFit',
        'render_html': render_html_es,
        'render_text': render_text_es,
        'campaign': 'free-talk-es-2026-05-05-gmail',
    },
}


# ─── 메인 ─────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Free-Talking 멀티언어 이메일 캠페인 (Gmail Send-as)")
    parser.add_argument("--lang", type=str, default="ko", choices=list(LANG_CONFIGS.keys()),
                        help="발송 대상 sourceLang (default: ko)")
    parser.add_argument("--dry-run", action="store_true", help="발송 없이 대상자 리스트만 출력")
    parser.add_argument("--only-email", type=str, help="단일 이메일에만 발송 (테스트)")
    parser.add_argument("--exclude-email", nargs="+", default=[], help="제외할 이메일 (여러 개 가능)")
    parser.add_argument("--limit", type=int, help="최대 발송 수")
    parser.add_argument("--throttle", type=int, default=THROTTLE_SECONDS, help="발송 간 대기 초 (default 3)")
    args = parser.parse_args()

    lang = args.lang
    cfg = LANG_CONFIGS[lang]

    # 환경변수 확인
    gmail_password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    firebase_key = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not gmail_password:
        print("❌ ERROR: GMAIL_APP_PASSWORD 환경변수 미설정"); sys.exit(1)
    if not firebase_key or not os.path.exists(firebase_key):
        print(f"❌ ERROR: FIREBASE_SERVICE_ACCOUNT not found: {firebase_key!r}"); sys.exit(1)
    if not os.path.exists(SCREENSHOT_PATH):
        print(f"❌ ERROR: 이미지 미존재: {SCREENSHOT_PATH}"); sys.exit(1)

    # 이미지 로드
    with open(SCREENSHOT_PATH, "rb") as f:
        img_data = f.read()
    print(f"📷 이미지 로드: {len(img_data):,} bytes (lang={lang})")

    # Firestore 초기화
    cred = credentials.Certificate(firebase_key)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print(f"🔥 Firestore 연결됨")

    # 후보 조회 — sourceLang 기준 (KR 캠페인 시 country=KR도 함께 일치, 그 외는 sourceLang만)
    lapsed_threshold = datetime.now(timezone.utc) - timedelta(days=LAPSED_DAYS)
    exclude_set = {e.lower() for e in args.exclude_email}
    only_email = args.only_email.lower() if args.only_email else None

    recipients = []
    print(f"🔍 sourceLang='{lang}' lapsed 후보 조회 중...")
    docs = db.collection("users").stream()
    for doc in docs:
        d = doc.to_dict()
        # sourceLang 필터 (lowercase 비교) — only-email 시 우회 (본인 카피 검증용)
        user_lang = (d.get("sourceLang") or "").lower()
        if not only_email and user_lang != lang:
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
        if d.get("emailOptOut") is True:
            continue
        if d.get("tier") == "admin":
            continue
        # idempotency (only_email 우회)
        if not only_email and d.get("freeTalkEmailSentAt"):
            continue
        # D0 신규 (only_email 우회)
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

    print(f"\n✅ 발송 대상: {len(recipients)} 명 (lang={lang})")
    if exclude_set:
        print(f"   제외: {len(exclude_set)} 개 이메일")

    if args.dry_run:
        print("\n[DRY RUN] 대상자 리스트:")
        for i, r in enumerate(recipients, 1):
            print(f"  {i:3}. {r['name'] or '(no name)':25} {r['email']}")
        return

    if not only_email:
        print(f"\n⚠️  실 발송 시작 — {len(recipients)}명 (lang={lang})")
        print(f"   subject: {cfg['subject']}")
        print(f"   throttle: {args.throttle}초/메일 → 예상 ~{args.throttle * len(recipients) / 60:.1f}분")
        confirm = input("   계속하시겠습니까? [y/N]: ").strip().lower()
        if confirm != "y":
            print("취소됨."); return

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

            msg = MIMEMultipart("related")
            msg["From"] = formataddr((SEND_AS_NAME, SEND_AS_EMAIL))
            msg["To"] = r["email"]
            msg["Subject"] = cfg['subject']
            msg["Reply-To"] = REPLY_TO
            msg["List-Unsubscribe"] = f"<{unsub_url}>"
            msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(cfg['render_text'](r["name"], unsub_url), "plain", "utf-8"))
            alt.attach(MIMEText(cfg['render_html'](r["name"], unsub_url), "html", "utf-8"))
            msg.attach(alt)

            img = MIMEImage(img_data, _subtype="jpeg")
            img.add_header("Content-ID", f"<{SCREENSHOT_CID}>")
            img.add_header("Content-Disposition", "inline", filename="free-talk-ko.jpg")
            msg.attach(img)

            smtp.sendmail(GMAIL_USER, [r["email"]], msg.as_string())

            db.collection("users").document(r["uid"]).update({
                "freeTalkEmailSentAt": firestore.SERVER_TIMESTAMP,
                "freeTalkEmailVia": "gmail-sendas",
                "freeTalkEmailCampaign": cfg['campaign'],
            })

            sent_count += 1
            print(f"  [{i+1}/{len(recipients)}] ✅ {r['email']}")

            if i < len(recipients) - 1:
                time.sleep(args.throttle)
        except Exception as e:
            failed.append({"email": r["email"], "error": str(e)})
            print(f"  [{i+1}/{len(recipients)}] ❌ {r['email']}: {e}")

    smtp.quit()
    print(f"\n📊 결과 (lang={lang})")
    print(f"   ✅ 발송 성공: {sent_count}/{len(recipients)}")
    if failed:
        print(f"   ❌ 실패: {len(failed)}")
        for f in failed:
            print(f"      {f['email']}: {f['error']}")


if __name__ == "__main__":
    main()
