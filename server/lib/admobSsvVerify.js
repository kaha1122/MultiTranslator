// AdMob 보상형 SSV 서명 검증 — PronunFit(routes/admobSsv.js)·K-DramaAnyLang(routes/kdlAdmobSsv.js) 공유.
//   [2026-09-16] KDL 이식 때 admobSsv.js에서 분리(두 파일에 복제하지 않기 위해). 동작은 원본과 동일.
// 검증 절차(공식): 쿼리스트링에서 '&signature=' 앞부분이 서명 대상 원문이고, signature 는
//   base64url ECDSA(P-256, SHA-256), 검증키는 key_id 로 verifier-keys.json 에서 찾는다.
//   ⚠ Express 가 파싱한 req.query 로 원문을 재조립하면 인코딩 차이로 서명이 깨진다 —
//     반드시 req.originalUrl 의 raw 쿼리를 그대로 써야 한다.
const crypto = require('crypto');
const axios = require('axios');

const VERIFIER_KEYS_URL = 'https://gstatic.com/admob/reward/verifier-keys.json';
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 콜백 신선도 — 재전송 공격 방어의 본체는 transaction_id 멱등이고, 이건 보조 가드.
// AdMob 재시도 윈도우를 넉넉히 덮도록 24h.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let _keys = { fetchedAt: 0, map: new Map() };

// Google 공개키 조회 + 캐싱. key_id 미스 시 force 로 1회 강제 갱신(키 로테이션 대응).
async function loadVerifierKeys(force = false) {
    const fresh = Date.now() - _keys.fetchedAt < KEY_CACHE_TTL_MS;
    if (!force && fresh && _keys.map.size) return _keys.map;
    const { data } = await axios.get(VERIFIER_KEYS_URL, { timeout: 8000 });
    const map = new Map();
    for (const k of data?.keys || []) {
        if (k?.keyId != null && k?.pem) map.set(String(k.keyId), k.pem);
    }
    if (!map.size) throw new Error('verifier-keys empty');
    _keys = { fetchedAt: Date.now(), map };
    console.log(`[AdMobSSV] verifier keys loaded: ${[...map.keys()].join(',')}`);
    return map;
}

function base64UrlToBuffer(s) {
    return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function verifySignature(rawQuery, keyId, signature) {
    const idx = rawQuery.indexOf('&signature=');
    if (idx < 0) return { ok: false, reason: 'no_signature_param' };
    const rawContent = rawQuery.slice(0, idx); // signature/key_id 앞까지가 서명 원문
    // 🚨 2026-09-16 실콜백으로 확정: Google은 쿼리를 **URL 디코딩한 문자열**에 서명한다(custom_data={"app":"kdl"} 처럼 %7B%22가 풀린 형태).
    //   인코딩된 원문으로 검증하면 인코딩이 필요한 문자가 하나라도 있으면 전부 bad_signature(KDL 내부 테스트 5회 연속 거절).
    //   디코딩본을 먼저, 실패 시 인코딩 원문도 시도(인코딩 필요 문자가 없는 콜백은 둘이 같다). 디코딩 실패(잘못된 %)는 원문만.
    let decodedContent = null;
    try { decodedContent = decodeURIComponent(rawContent); } catch { decodedContent = null; }
    const contents = [...new Set([decodedContent, rawContent].filter((c) => typeof c === 'string'))];
    const sigBuf = base64UrlToBuffer(signature);

    const tryVerify = async (force) => {
        const keys = await loadVerifierKeys(force);
        const pem = keys.get(String(keyId));
        if (!pem) return null; // 키 미보유 → 상위에서 force 재시도
        for (const content of contents) {
            try {
                if (crypto.verify('sha256', Buffer.from(content, 'utf8'), { key: pem, dsaEncoding: 'der' }, sigBuf)) return true;
            } catch { /* 키 파싱·형식 오류 → 다음 후보 */ }
        }
        return false;
    };

    let result = await tryVerify(false);
    if (result === null) result = await tryVerify(true); // 키 로테이션 → 강제 갱신 후 1회 재시도
    if (result === null) return { ok: false, reason: 'unknown_key_id' };
    return { ok: result === true, reason: result ? 'ok' : 'bad_signature' };
}


// 콜백 신선도 — 재전송 공격 방어의 본체는 transaction_id 멱등이고, 이건 보조 가드. AdMob 재시도 윈도우를 덮도록 24h.
const isStale = (timestamp) => {
    const ts = Number(timestamp || 0);
    return Number.isFinite(ts) && ts > 0 && Math.abs(Date.now() - ts) > MAX_AGE_MS;
};

module.exports = { verifySignature, loadVerifierKeys, isStale, MAX_AGE_MS };
