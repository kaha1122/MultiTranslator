// ── K-DramaAnyLang Zero-Tap 로그인 복원 토큰 (additive — PronunFit 라우트 무변경) ──
// Google Play 앱 품질 요건(Zero-Tap Sign-In, 2027-04 시행 / Block Store 통합 2026-09-30
// 이전 완료 시 예외 인정) 대응. Android 클라이언트가 Block Store에 저장하는 것은
// 여기서 발급한 "불투명 복원 토큰"뿐이다 — Firebase refresh token을 기기 밖 저장소에
// 직접 두지 않기 위한 간접 계층. 서버가 토큰 문서를 지우면 즉시 무효화된다.
//
// 저장소: kculture Firestore `restore_tokens/{sha256(token)}` = { uid, createdAt }
//   Admin SDK 전용 컬렉션 — firestore.rules 변경/재게시 불필요(기본 deny).
//
// 흐름:
//   issue  (인증)   로그인된 kculture 유저에게 새 토큰 발급 → 클라가 Block Store에 저장
//   redeem (비인증) 새 기기가 Block Store에서 복원한 토큰 제출 → 1회용 검증 후
//                   Firebase custom token + 차기 복원 토큰 반환(연속성 유지)
//
// ⚠ requireAuthAny를 쓰지 않는 이유: 그 미들웨어는 PronunFit 토큰도 통과시킨다.
//   PronunFit uid로 kculture custom token을 발급하면 kculture에 유령 계정이 생기므로
//   발급은 반드시 kculture 프로젝트 토큰만 인정한다.
const express = require('express');
const crypto = require('crypto');
const { kcultureAuth, kcultureDb } = require('../config/firebaseKculture');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const TOKEN_TTL_MS = 400 * 24 * 3600 * 1000; // 기기 이전은 수개월 뒤에도 일어난다 — 미사용 400일 만료
const MAX_TOKENS_PER_UID = 5; // 복수 기기 허용 상한 — 초과분은 오래된 것부터 폐기(무한 증식 방지)

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url'); // 43자, 256bit 엔트로피

// kculture 토큰 전용 검증 (위 ⚠ 참조)
async function requireKcultureAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization header required' });
    }
    if (!kcultureAuth) return res.status(503).json({ error: 'restore unavailable' });
    try {
        const decoded = await kcultureAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
        // 익명(게스트) 계정은 복원 대상이 아님 — 정식 로그인만 발급
        if (decoded.firebase?.sign_in_provider === 'anonymous') {
            return res.status(403).json({ error: 'anonymous not eligible' });
        }
        req.uid = decoded.uid;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ── 발급 — 로그인 직후/주기 로테이션 시 클라가 호출 ──────────────────────────
router.post(
    '/api/community/restore-token/issue',
    requireKcultureAuth,
    rateLimit('restore-issue', { perMinute: 5, perHour: 20 }),
    async (req, res) => {
        if (!kcultureDb) return res.status(503).json({ error: 'restore unavailable' });
        try {
            const token = newToken();
            const col = kcultureDb.collection('restore_tokens');
            await col.doc(sha256(token)).set({ uid: req.uid, createdAt: Date.now() });

            // uid당 상한 정리 — 실패해도 발급 자체는 유효(fire-and-forget성 정리)
            try {
                const snap = await col.where('uid', '==', req.uid).get();
                if (snap.size > MAX_TOKENS_PER_UID) {
                    const sorted = snap.docs.sort(
                        (a, b) => (a.get('createdAt') || 0) - (b.get('createdAt') || 0)
                    );
                    await Promise.all(
                        sorted.slice(0, snap.size - MAX_TOKENS_PER_UID).map((d) => d.ref.delete())
                    );
                }
            } catch (e) {
                console.warn('[restore-token] prune failed:', e.message);
            }

            res.json({ restoreToken: token });
        } catch (e) {
            console.error('[restore-token] issue failed:', e.message);
            res.status(500).json({ error: 'issue failed' });
        }
    }
);

// ── 상환 — 새 기기 첫 실행(비로그인)에서 호출. 1회용: 성공 즉시 폐기 + 차기 토큰 발급 ──
router.post(
    '/api/community/restore-token/redeem',
    rateLimit('restore-redeem', { perMinute: 3, perHour: 10 }), // 비인증 → IP 키
    async (req, res) => {
        if (!kcultureDb || !kcultureAuth) return res.status(503).json({ error: 'restore unavailable' });
        try {
            const token = String(req.body?.token || '');
            if (token.length < 32) return res.status(401).json({ error: 'invalid token' });

            const ref = kcultureDb.collection('restore_tokens').doc(sha256(token));
            const doc = await ref.get();
            if (!doc.exists) return res.status(401).json({ error: 'invalid token' });

            const { uid, createdAt } = doc.data() || {};
            if (!uid || Date.now() - (createdAt || 0) > TOKEN_TTL_MS) {
                await ref.delete();
                return res.status(401).json({ error: 'invalid token' });
            }

            // 계정 상태 확인 — 삭제·사용중지(모더레이션 제재) 계정은 복원 불가 + 토큰 폐기
            try {
                const user = await kcultureAuth.getUser(uid);
                if (user.disabled) {
                    await ref.delete();
                    return res.status(401).json({ error: 'invalid token' });
                }
            } catch {
                await ref.delete();
                return res.status(401).json({ error: 'invalid token' });
            }

            // 1회용 처리: 차기 토큰을 먼저 만들고 → 기존 폐기 → custom token 발급
            const next = newToken();
            await kcultureDb
                .collection('restore_tokens')
                .doc(sha256(next))
                .set({ uid, createdAt: Date.now() });
            await ref.delete();

            const customToken = await kcultureAuth.createCustomToken(uid);
            console.log(`[restore-token] redeemed uid=${uid.slice(0, 8)}…`);
            res.json({ customToken, restoreToken: next });
        } catch (e) {
            console.error('[restore-token] redeem failed:', e.message);
            res.status(500).json({ error: 'redeem failed' });
        }
    }
);

module.exports = router;
