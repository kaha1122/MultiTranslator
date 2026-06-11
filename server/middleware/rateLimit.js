// 인메모리 rate limiter — uid(인증) 또는 IP(미인증) 키 기준 슬라이딩 윈도우.
// 2026-06-11 도입 배경: AI proxy 엔드포인트(Azure/Gemini 과금)가 무제한 호출 가능해
// 토큰 하나(또는 무토큰)로 예산을 소진시킬 수 있던 구멍 차단. 외부 의존성 없이
// Render 단일 인스턴스 전제의 경량 구현 (인스턴스 재시작 시 카운터 리셋은 수용).
//
// 사용: router.post('/api/x', requireAuth, rateLimit('x', { perMinute: 20, perHour: 200 }), handler)
// 정상 유저는 닿지 않는 상한으로 설정 — 스크립트성 남용만 차단하는 게 목적.

const buckets = new Map(); // `${name}:${key}` → number[] (timestamps ms)

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

// 주기적 청소 — 1시간 넘은 타임스탬프만 남은 엔트리 제거 (메모리 무한 증가 방지)
setInterval(() => {
    const cutoff = Date.now() - HOUR;
    for (const [key, arr] of buckets) {
        const fresh = arr.filter(t => t > cutoff);
        if (fresh.length === 0) buckets.delete(key);
        else buckets.set(key, fresh);
    }
}, 10 * MINUTE).unref();

function clientKey(req) {
    if (req.uid) return `u:${req.uid}`;
    const fwd = req.headers['x-forwarded-for'] || '';
    return `ip:${fwd.split(',')[0]?.trim() || req.ip || 'unknown'}`;
}

function rateLimit(name, { perMinute = 0, perHour = 0 } = {}) {
    return (req, res, next) => {
        const key = `${name}:${clientKey(req)}`;
        const now = Date.now();
        const arr = buckets.get(key) || [];
        const lastHour = arr.filter(t => t > now - HOUR);

        if (perHour && lastHour.length >= perHour) {
            console.warn(`[RateLimit] ${key} exceeded ${perHour}/hour`);
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }
        if (perMinute) {
            const lastMinute = lastHour.filter(t => t > now - MINUTE);
            if (lastMinute.length >= perMinute) {
                console.warn(`[RateLimit] ${key} exceeded ${perMinute}/min`);
                return res.status(429).json({ error: 'Too many requests. Please try again later.' });
            }
        }
        lastHour.push(now);
        buckets.set(key, lastHour);
        next();
    };
}

module.exports = { rateLimit };
