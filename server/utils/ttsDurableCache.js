// ─────────────────────────────────────────────────────────────────────────
// ttsDurableCache.js — Azure TTS mp3 영속(write-through) 캐시 (Firebase Storage)
//
// 목적: 고정/공통 콘텐츠(온보딩 고정 문장, Phase 2 seed 학습자료)의 TTS를
//       전역에서 한 번만 합성 → Storage에 저장 → 모든 유저가 재사용.
//       인메모리 LRU(ttsCache.js)는 Render 재시작 시 소멸하므로, 콜드 인스턴스/
//       신규 유저가 같은 고정 문장으로 Azure를 재호출하는 비용을 영속 캐시로 차단.
//
// 특성:
//   - 키: sha256(ssml).mp3 — ttsCache.js와 동일 키 규칙(voice/lang/swap 인코딩됨).
//   - 경로: gs://<bucket>/tts-cache/{sha256}.mp3
//   - durable 플래그가 붙은 요청에만 사용(1회성 유저 지문은 인메모리만 — 누적 방지).
//   - **안전 no-op**: FIREBASE_STORAGE_BUCKET 미설정 / Storage 미가용 / 에러 시
//     전부 조용히 비활성 → TTS 본 흐름(인메모리+Azure)에 절대 영향 없음.
//
// 활성화: Render 환경변수 FIREBASE_STORAGE_BUCKET = <project>.appspot.com
//         (또는 신규 프로젝트는 <project>.firebasestorage.app). Storage 활성 필요.
// ─────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const { admin } = require('../config/firebase');

const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || '';
const PREFIX = 'tts-cache/';

let bucket = null;
let disabled = false;

function getBucket() {
    if (disabled) return null;
    if (bucket) return bucket;
    if (!BUCKET_NAME || !admin.apps.length) {
        disabled = true; // 버킷 미지정 또는 admin 미초기화 → 영구 비활성(로컬/미설정 환경)
        return null;
    }
    try {
        bucket = admin.storage().bucket(BUCKET_NAME);
        console.log(`[ttsDurableCache] enabled — bucket=${BUCKET_NAME}`);
        return bucket;
    } catch (e) {
        console.warn('[ttsDurableCache] Storage unavailable — durable cache disabled:', e.message);
        disabled = true;
        return null;
    }
}

const keyFor = (ssml) => crypto.createHash('sha256').update(String(ssml)).digest('hex');

/** 영속 캐시 조회. @returns {Promise<Buffer|null>} */
async function get(ssml) {
    const b = getBucket();
    if (!b) return null;
    try {
        const file = b.file(`${PREFIX}${keyFor(ssml)}.mp3`);
        const [exists] = await file.exists();
        if (!exists) return null;
        const [buf] = await file.download();
        return buf;
    } catch (e) {
        console.warn('[ttsDurableCache] get failed (무시):', e.message);
        return null;
    }
}

/** 영속 캐시 저장(write-through). fire-and-forget 권장. */
async function set(ssml, buf) {
    const b = getBucket();
    if (!b || !buf || !buf.length) return;
    try {
        const file = b.file(`${PREFIX}${keyFor(ssml)}.mp3`);
        await file.save(buf, {
            resumable: false,
            contentType: 'audio/mpeg',
            metadata: { cacheControl: 'public, max-age=31536000, immutable' },
        });
    } catch (e) {
        console.warn('[ttsDurableCache] set failed (무시):', e.message);
    }
}

/** 영속 캐시 사용 가능 여부(요청 시점 게이트용). */
const isEnabled = () => !disabled && !!BUCKET_NAME && admin.apps.length > 0;

module.exports = { get, set, isEnabled };
