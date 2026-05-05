// Resend 이메일 발송 유틸 + 베트남어 Free Talk 캠페인 템플릿
// 2026-05-04 도입 — VN lapsed 유저 106명 대상 첫 캠페인
//
// 보안:
//   - RESEND_API_KEY는 서버 env 변수 (Render에서만)
//   - UNSUBSCRIBE_SECRET (선택) — HMAC 서명용. 미설정 시 token 검증 우회
//
// 이미지 처리:
//   - 2026-05-04 변경: 외부 URL → inline attachment (cid:) 방식
//     · Gmail/Outlook 의 외부 이미지 기본 차단 우회
//     · 메일당 +303KB (106명 × = ~32MB 무료 한도 안에 듬)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let resendClient = null;
function getResend() {
    if (resendClient) return resendClient;
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.warn('[Email] RESEND_API_KEY not set — email sending disabled');
        return null;
    }
    const { Resend } = require('resend');
    resendClient = new Resend(apiKey);
    return resendClient;
}

const FROM_NAME = 'PronunFit System Administrator';
const FROM_EMAIL = 'systemadmin@pronunfit.com';
const FROM_FULL = `${FROM_NAME} <${FROM_EMAIL}>`;
const REPLY_TO = 'systemadmin@pronunfit.com';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.arigems.pronunfit';
const PRIVACY_URL = 'https://pronunfit.com/privacy';

// 이미지 inline embed — public/email-assets/free-talk-{lang}.jpg 를 cid:reference로 첨부
// HTML에서 <img src="cid:free-talk-screenshot"> 로 참조
const SCREENSHOT_CID = 'free-talk-screenshot';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', 'public', 'email-assets');
const cachedImageBuffers = {}; // { vi: Buffer, ko: Buffer }
function getScreenshotBuffer(lang) {
    if (cachedImageBuffers[lang]) return cachedImageBuffers[lang];
    const filePath = path.join(SCREENSHOT_DIR, `free-talk-${lang}.jpg`);
    try {
        cachedImageBuffers[lang] = fs.readFileSync(filePath);
        console.log(`[Email] Loaded ${lang} screenshot ${cachedImageBuffers[lang].length} bytes`);
        return cachedImageBuffers[lang];
    } catch (e) {
        console.warn(`[Email] Failed to load ${lang} screenshot:`, e.message);
        return null;
    }
}

// 수신거부 토큰 — HMAC SHA256 (UNSUBSCRIBE_SECRET 미설정 시 plain uid 사용)
function makeUnsubToken(uid) {
    const secret = process.env.UNSUBSCRIBE_SECRET || '';
    if (!secret) return ''; // verification 우회 모드
    return crypto.createHmac('sha256', secret).update(uid).digest('hex').slice(0, 24);
}

function verifyUnsubToken(uid, token) {
    const expected = makeUnsubToken(uid);
    if (!expected) return true; // secret 없으면 통과 (개발 모드)
    return token === expected;
}

function unsubscribeUrl(uid, baseUrl) {
    const token = makeUnsubToken(uid);
    const url = new URL('/api/unsubscribe-email', baseUrl);
    url.searchParams.set('uid', uid);
    if (token) url.searchParams.set('t', token);
    return url.toString();
}

// 베트남어 Free Talk 캠페인 HTML 템플릿
function renderFreeTalkEmailVI({ name, unsubLink }) {
    const safeName = (name || '').replace(/[<>]/g, '');
    const greeting = safeName ? `Xin chào ${safeName}!` : 'Xin chào!';
    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free Talk đã ra mắt trên PronunFit</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
      <!-- Header -->
      <tr><td style="padding:28px 28px 8px 28px;text-align:center;">
        <div style="font-size:1.6rem;font-weight:800;color:#7B2D8E;letter-spacing:-0.5px;">PronunFit</div>
        <div style="font-size:0.85rem;color:#94a3b8;margin-top:4px;">Học phát âm thông minh với AI</div>
      </td></tr>

      <!-- Title -->
      <tr><td style="padding:8px 28px 16px 28px;">
        <h1 style="margin:16px 0 8px 0;font-size:1.5rem;line-height:1.3;color:#1e293b;font-weight:800;text-align:center;">
          🎙️ Free Talk đã ra mắt!
        </h1>
        <p style="margin:0;color:#64748b;font-size:0.95rem;text-align:center;line-height:1.5;">
          Tính năng mới — luyện nói tự do với AI trong tình huống thực tế.
        </p>
      </td></tr>

      <!-- Hero Image — inline cid attachment (Gmail external image 차단 우회) -->
      <tr><td style="padding:8px 28px;text-align:center;">
        <img src="cid:${SCREENSHOT_CID}" alt="Free Talk demo screenshot" width="280"
             style="max-width:280px;width:100%;height:auto;border-radius:12px;border:1px solid #e2e8f0;display:block;margin:0 auto;">
      </td></tr>

      <!-- Greeting -->
      <tr><td style="padding:24px 28px 8px 28px;">
        <p style="margin:0 0 12px 0;font-size:1rem;color:#1e293b;">
          ${greeting}
        </p>
        <p style="margin:0;font-size:0.95rem;color:#475569;line-height:1.6;">
          Bạn có nhớ PronunFit không? Chúng tôi rất vui khi báo tin: tính năng <strong>Free Talk</strong> mà bạn nhất định nên thử đã chính thức ra mắt.
        </p>
      </td></tr>

      <!-- Feature breakdown -->
      <tr><td style="padding:16px 28px 8px 28px;">
        <h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">
          🌟 Free Talk là gì?
        </h2>
        <p style="margin:0 0 12px 0;font-size:0.92rem;color:#475569;line-height:1.6;">
          Khác với những bài tập hỏi-đáp cứng nhắc trước đây, Free Talk cho phép bạn:
        </p>
        <ul style="margin:0;padding-left:20px;color:#475569;font-size:0.92rem;line-height:1.8;">
          <li>✨ <strong>Trò chuyện tự nhiên với AI</strong> — như đang nói với một người bạn nước ngoài</li>
          <li>🎯 <strong>Tình huống thực tế</strong> — sân bay, nhà hàng, khách sạn, tàu cao tốc...</li>
          <li>🗣️ <strong>8 lượt mỗi cuộc hội thoại</strong> — đủ thời gian thực hành kỹ năng nói</li>
          <li>⚡ <strong>Phản hồi tức thì</strong> — chấm điểm phát âm ngay lập tức</li>
        </ul>
      </td></tr>

      <!-- Scenarios -->
      <tr><td style="padding:16px 28px 8px 28px;">
        <h2 style="margin:0 0 12px 0;font-size:1.1rem;color:#1e293b;font-weight:700;">
          🎬 Tình huống có sẵn
        </h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:0.92rem;color:#475569;">
          <tr><td style="padding:4px 0;">🚄 Trên tàu Shinkansen — bắt chuyện với hành khách</td></tr>
          <tr><td style="padding:4px 0;">☕ Tại quán cà phê — gọi đồ uống yêu thích</td></tr>
          <tr><td style="padding:4px 0;">✈️ Sân bay — làm thủ tục check-in</td></tr>
          <tr><td style="padding:4px 0;">🏨 Khách sạn — nhận phòng và yêu cầu dịch vụ</td></tr>
          <tr><td style="padding:4px 0;">🛒 Mua sắm — hỏi giá và mặc cả</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">... và nhiều tình huống thú vị khác!</td></tr>
        </table>
      </td></tr>

      <!-- Free notice -->
      <tr><td style="padding:20px 28px 8px 28px;text-align:center;">
        <div style="display:inline-block;padding:8px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:24px;color:#166534;font-size:0.88rem;font-weight:600;">
          💛 Hoàn toàn miễn phí — 10 thẻ học mỗi ngày
        </div>
      </td></tr>

      <!-- CTA Button -->
      <tr><td style="padding:24px 28px;text-align:center;">
        <a href="${PLAY_STORE_URL}"
           style="display:inline-block;padding:16px 32px;background:#7B2D8E;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:1.05rem;letter-spacing:0.2px;">
          🚀 THỬ FREE TALK NGAY
        </a>
        <p style="margin:12px 0 0 0;font-size:0.82rem;color:#94a3b8;">
          Mở ứng dụng → vào tab "Hội thoại" 💬 → chọn Free Talk
        </p>
      </td></tr>

      <!-- Sign-off -->
      <tr><td style="padding:8px 28px 28px 28px;border-top:1px solid #e2e8f0;margin-top:16px;">
        <p style="margin:16px 0 4px 0;font-size:0.92rem;color:#475569;line-height:1.6;">
          Cảm ơn bạn đã đồng hành cùng PronunFit. Chúng tôi mong gặp lại bạn!
        </p>
        <p style="margin:0;font-size:0.92rem;color:#475569;font-weight:600;">
          — Đội ngũ PronunFit
        </p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:16px 28px 24px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
        <p style="margin:0 0 8px 0;font-size:0.78rem;color:#94a3b8;line-height:1.6;">
          PronunFit — Học phát âm thông minh với AI<br>
          🌐 <a href="https://pronunfit.com" style="color:#94a3b8;text-decoration:underline;">pronunfit.com</a>
          &nbsp;·&nbsp;
          ✉️ <a href="mailto:${REPLY_TO}" style="color:#94a3b8;text-decoration:underline;">${REPLY_TO}</a>
        </p>
        <p style="margin:8px 0 0 0;font-size:0.74rem;color:#cbd5e1;line-height:1.6;">
          Bạn nhận email này vì đã đăng ký tài khoản PronunFit. Đây là thông báo về tính năng mới của dịch vụ.
          <br>
          <a href="${unsubLink}" style="color:#94a3b8;text-decoration:underline;">Hủy đăng ký nhận email từ PronunFit</a>
          &nbsp;·&nbsp;
          <a href="${PRIVACY_URL}" style="color:#94a3b8;text-decoration:underline;">Chính sách bảo mật</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// 텍스트 fallback (HTML 미지원 클라이언트용)
function renderFreeTalkEmailViText({ name, unsubLink }) {
    const greeting = name ? `Xin chào ${name}!` : 'Xin chào!';
    return `${greeting}

🎙️ Free Talk đã ra mắt trên PronunFit!

Bạn có nhớ PronunFit không? Chúng tôi rất vui khi báo tin: tính năng Free Talk mà bạn nhất định nên thử đã chính thức ra mắt.

🌟 Free Talk là gì?

✨ Trò chuyện tự nhiên với AI — như đang nói với một người bạn nước ngoài
🎯 Tình huống thực tế — sân bay, nhà hàng, khách sạn, tàu cao tốc...
🗣️ 8 lượt mỗi cuộc hội thoại
⚡ Phản hồi tức thì — chấm điểm phát âm ngay lập tức

🎬 Tình huống có sẵn:
🚄 Trên tàu Shinkansen
☕ Tại quán cà phê
✈️ Sân bay
🏨 Khách sạn
🛒 Mua sắm
... và nhiều hơn nữa!

💛 Hoàn toàn miễn phí với 10 thẻ học mỗi ngày.

🚀 THỬ FREE TALK NGAY:
${PLAY_STORE_URL}

Mở ứng dụng → vào tab "Hội thoại" 💬 → chọn Free Talk

—

Cảm ơn bạn đã đồng hành cùng PronunFit. Chúng tôi mong gặp lại bạn!
— Đội ngũ PronunFit

PronunFit — Học phát âm thông minh với AI
https://pronunfit.com
${REPLY_TO}

---
Bạn nhận email này vì đã đăng ký tài khoản PronunFit.
Hủy đăng ký: ${unsubLink}
`;
}

// 한국어 Free Talk 캠페인 HTML 템플릿
function renderFreeTalkEmailKO({ name, unsubLink }) {
    const safeName = (name || '').replace(/[<>]/g, '');
    const greeting = safeName ? `안녕하세요 ${safeName}님!` : '안녕하세요!';
    return `<!DOCTYPE html>
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
        <img src="cid:${SCREENSHOT_CID}" alt="Free Talk demo screenshot" width="280"
             style="max-width:280px;width:100%;height:auto;border-radius:12px;border:1px solid #e2e8f0;display:block;margin:0 auto;">
      </td></tr>

      <tr><td style="padding:24px 28px 8px 28px;">
        <p style="margin:0 0 12px 0;font-size:1rem;color:#1e293b;">
          ${greeting}
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
        <a href="${PLAY_STORE_URL}"
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
          ✉️ <a href="mailto:${REPLY_TO}" style="color:#94a3b8;text-decoration:underline;">${REPLY_TO}</a>
        </p>
        <p style="margin:8px 0 0 0;font-size:0.74rem;color:#cbd5e1;line-height:1.6;">
          PronunFit 계정 가입자에게 발송된 서비스 알림 메일입니다.
          <br>
          <a href="${unsubLink}" style="color:#94a3b8;text-decoration:underline;">수신 거부</a>
          &nbsp;·&nbsp;
          <a href="${PRIVACY_URL}" style="color:#94a3b8;text-decoration:underline;">개인정보 처리방침</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function renderFreeTalkEmailKoText({ name, unsubLink }) {
    const greeting = name ? `안녕하세요 ${name}님!` : '안녕하세요!';
    return `${greeting}

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
${PLAY_STORE_URL}

앱 열기 → 사이드바 "Free-Talking" 탭 → 상황/장소 설정 → "Free Talking" 버튼

—

PronunFit과 함께해주셔서 감사합니다. 다시 만나길 기다리고 있어요!
— PronunFit 팀

PronunFit — AI로 똑똑하게 발음 학습
https://pronunfit.com
${REPLY_TO}

---
PronunFit 계정 가입자에게 발송된 서비스 알림 메일입니다.
수신 거부: ${unsubLink}
`;
}

// 언어별 카피 매핑
const SUBJECT_BY_LANG = {
    vi: '🎙️ Free Talk: trò chuyện thật với AI ngay trong PronunFit',
    ko: '🎙️ Free Talk: AI와 진짜 대화하기 — PronunFit 신기능',
};
const CAMPAIGN_TAG_BY_LANG = {
    vi: 'free-talk-vn-2026-05-04',
    ko: 'free-talk-kr-2026-05-05',
};

/**
 * Free Talk 캠페인 이메일 발송
 * @param {{ to: string, name?: string, uid: string, baseUrl: string, lang?: 'vi'|'ko', dryRun?: boolean }} opts
 */
async function sendFreeTalkEmail({ to, name, uid, baseUrl, lang = 'vi', dryRun = false }) {
    const resend = getResend();
    if (!resend) return { ok: false, reason: 'resend-not-init' };

    const unsubLink = unsubscribeUrl(uid, baseUrl);
    const html = lang === 'ko'
        ? renderFreeTalkEmailKO({ name, unsubLink })
        : renderFreeTalkEmailVI({ name, unsubLink });
    const text = lang === 'ko'
        ? renderFreeTalkEmailKoText({ name, unsubLink })
        : renderFreeTalkEmailViText({ name, unsubLink });
    const subject = SUBJECT_BY_LANG[lang] || SUBJECT_BY_LANG.vi;

    if (dryRun) {
        return {
            ok: true, dryRun: true,
            preview: { from: FROM_FULL, to, subject, lang, htmlLength: html.length, textLength: text.length, unsubLink },
        };
    }

    // 언어별 이미지 inline 첨부
    const imgBuffer = getScreenshotBuffer(lang);
    const attachments = imgBuffer ? [{
        filename: `free-talk-${lang}.jpg`,
        content: imgBuffer,
        contentType: 'image/jpeg',
        contentId: SCREENSHOT_CID,
    }] : [];

    try {
        const result = await resend.emails.send({
            from: FROM_FULL,
            to,
            replyTo: REPLY_TO,
            subject,
            html,
            text,
            headers: {
                'List-Unsubscribe': `<${unsubLink}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
            attachments,
            tags: [{ name: 'campaign', value: CAMPAIGN_TAG_BY_LANG[lang] || CAMPAIGN_TAG_BY_LANG.vi }],
        });
        if (result.error) return { ok: false, reason: result.error.message || 'resend-error', detail: result.error };
        return { ok: true, id: result.data?.id };
    } catch (e) {
        console.warn('[Email] sendFreeTalkEmail failed:', e.message);
        return { ok: false, reason: e.message };
    }
}

module.exports = { sendFreeTalkEmail, makeUnsubToken, verifyUnsubToken };
