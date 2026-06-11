// ─────────────────────────────────────────────────────────────────────────
// ttsUsage.js — 유저별 TTS 사용량 집계 (users/{uid}/analytics/ttsUsage)
//
// 목적: 누가 얼마나 TTS를 쓰고(서버 도달 기준), 서버 캐시가 얼마나 먹는지(hit),
//       Azure 과금이 얼마나 발생하는지(miss/billableChars)를 유저별로 누적.
//
// 방식: 매 요청마다 Firestore 쓰면 단일 문서 연타 경합 + 쓰기 비용 → 인메모리 누적 후
//       60초마다 batch flush (유저당 최대 1 write/분). [TTSCache] 스냅샷과 동일 패턴.
//
// 🔥 발열 주의: 절대 users/{uid} 본문에 쓰지 말 것. 클라 AuthContext가 users/{uid}를
//    onSnapshot 구독 중이라, 본문 write는 60초마다 App 전체 재렌더(iOS 발열 C1 원인)를
//    유발한다 (2026-06-12 발열 분석). 통계류는 analytics 서브컬렉션에만 기록.
//    (~2026-06-12까지 누적분은 users/{uid}.ttsUsage 필드에 남아있음 — 조회 시 양쪽 합산)
//
// 한계: 클라 캐시(메모리/IndexedDB)로 재생한 건 서버에 안 와서 미집계 → "서버 도달 재생" 기준
//       (비용 관점에선 정확 — 클라 캐시 재생은 비용 0). 재시작 시 최대 ~60초 유실(통계라 허용).
// 필드: requests(=hit+miss) / miss(과금) / hit(서버캐시) / billableChars(= ×$0.000015 비용) / updatedAt
// ─────────────────────────────────────────────────────────────────────────
const { adminDb } = require('../config/firebase');
const admin = require('firebase-admin');

const FLUSH_MS = 60_000;
const BATCH_LIMIT = 450; // Firestore batch 한도(500) 여유

/** @type {Map<string, {requests:number, miss:number, hit:number, billableChars:number}>} */
const pending = new Map();

/**
 * TTS 1건 기록(인메모리 누적). uid 없으면(익명 미인증/로컬) skip.
 * @param {string|null} uid
 * @param {{hit:boolean, billable:number}} info
 */
function recordTtsUsage(uid, { hit, billable }) {
    if (!uid || uid === 'dev-user') return;
    const e = pending.get(uid) || { requests: 0, miss: 0, hit: 0, billableChars: 0 };
    e.requests += 1;
    if (hit) e.hit += 1;
    else { e.miss += 1; e.billableChars += (billable || 0); }
    pending.set(uid, e);
}

async function flush() {
    if (!adminDb || pending.size === 0) return;
    const inc = admin.firestore.FieldValue.increment;
    const entries = Array.from(pending.entries());
    pending.clear();

    for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
        const chunk = entries.slice(i, i + BATCH_LIMIT);
        const batch = adminDb.batch();
        for (const [uid, e] of chunk) {
            // 서브컬렉션 문서에 기록 — users/{uid} 본문 onSnapshot을 깨우지 않음 (발열 차단)
            batch.set(adminDb.collection('users').doc(uid).collection('analytics').doc('ttsUsage'), {
                requests: inc(e.requests),
                miss: inc(e.miss),
                hit: inc(e.hit),
                billableChars: inc(e.billableChars),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        try {
            await batch.commit();
        } catch (err) {
            // batch는 원자적 → 실패 시 누적분 재큐(double-count 없음). best-effort.
            console.warn('[ttsUsage] flush chunk failed, re-queued:', err?.message);
            for (const [uid, e] of chunk) {
                const cur = pending.get(uid) || { requests: 0, miss: 0, hit: 0, billableChars: 0 };
                cur.requests += e.requests; cur.miss += e.miss; cur.hit += e.hit; cur.billableChars += e.billableChars;
                pending.set(uid, cur);
            }
        }
    }
}

const timer = setInterval(flush, FLUSH_MS);
if (timer.unref) timer.unref();

module.exports = { recordTtsUsage };
