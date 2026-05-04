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

// 이미지 inline embed — public/email-assets/free-talk-vn.jpg 를 cid:reference로 첨부
// HTML에서 <img src="cid:free-talk-screenshot"> 로 참조
const SCREENSHOT_CID = 'free-talk-screenshot';
const SCREENSHOT_FILE_PATH = path.resolve(__dirname, '..', '..', 'public', 'email-assets', 'free-talk-vn.jpg');
let cachedImageBuffer = null;
function getScreenshotBuffer() {
    if (cachedImageBuffer) return cachedImageBuffer;
    try {
        cachedImageBuffer = fs.readFileSync(SCREENSHOT_FILE_PATH);
        console.log(`[Email] Loaded screenshot ${cachedImageBuffer.length} bytes from ${SCREENSHOT_FILE_PATH}`);
        return cachedImageBuffer;
    } catch (e) {
        console.warn('[Email] Failed to load screenshot:', e.message);
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

/**
 * Free Talk 캠페인 이메일 발송
 * @param {{ to: string, name?: string, uid: string, baseUrl: string, dryRun?: boolean }} opts
 */
async function sendFreeTalkEmail({ to, name, uid, baseUrl, dryRun = false }) {
    const resend = getResend();
    if (!resend) return { ok: false, reason: 'resend-not-init' };

    const unsubLink = unsubscribeUrl(uid, baseUrl);
    const html = renderFreeTalkEmailVI({ name, unsubLink });
    const text = renderFreeTalkEmailViText({ name, unsubLink });
    const subject = '🎙️ Free Talk: trò chuyện thật với AI ngay trong PronunFit';

    if (dryRun) {
        return {
            ok: true, dryRun: true,
            preview: { from: FROM_FULL, to, subject, htmlLength: html.length, textLength: text.length, unsubLink },
        };
    }

    // 이미지 inline 첨부 (cid:free-talk-screenshot)
    const imgBuffer = getScreenshotBuffer();
    const attachments = imgBuffer ? [{
        filename: 'free-talk-vn.jpg',
        content: imgBuffer,
        contentType: 'image/jpeg',
        contentId: SCREENSHOT_CID, // HTML 의 <img src="cid:..."> 와 일치
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
                // RFC 8058 — List-Unsubscribe header (Gmail/Outlook unsubscribe button 활성화)
                'List-Unsubscribe': `<${unsubLink}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
            attachments,
            tags: [{ name: 'campaign', value: 'free-talk-vn-2026-05-04' }],
        });
        if (result.error) return { ok: false, reason: result.error.message || 'resend-error', detail: result.error };
        return { ok: true, id: result.data?.id };
    } catch (e) {
        console.warn('[Email] sendFreeTalkEmail failed:', e.message);
        return { ok: false, reason: e.message };
    }
}

module.exports = { sendFreeTalkEmail, makeUnsubToken, verifyUnsubToken };
