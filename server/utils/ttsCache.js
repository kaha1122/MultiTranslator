// ─────────────────────────────────────────────────────────────────────────
// ttsCache.js — Azure TTS 응답(mp3) 인메모리 LRU 캐시
//
// 목적: 동일 SSML(= 동일 text+voice+emotion+dialogue swap)은 Azure 출력 mp3가
//       100% 동일하므로, 한 번 합성한 결과를 메모리에 보관해 재합성을 막는다.
//       Azure Neural TTS 비용(글자 수 과금) 절감용.
//
// 특성:
//   - 키: sha256(ssml). SSML이 voice/style/swap/언어를 모두 인코딩하므로
//         별도 정규화 불필요.
//   - LRU: 삽입 순서 Map. 상한 초과 시 가장 오래 안 쓰인 항목 제거 → 무한 증가 차단.
//   - 영속성 없음(의도적): Render 재시작 시 비워짐. 1회성 콘텐츠(유저별 passage)는
//         자동 증발 → 스토리지 누적 걱정 없음. 공통 단어/연타/반복만 적중.
//   - BYOK 요청은 호출부에서 bypass(다른 계정·과금 분리).
// ─────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

// 핫 엔트리 상한. 192kbit mp3 평균 수십~수백KB → 300개면 대략 수십MB 내.
const MEM_MAX = Number(process.env.TTS_CACHE_MAX || 300);
// 2026-06-11 바이트 상한 추가 — Listening 장문 지문은 개당 1~1.7MB(40~70초)라 항목 수
// 상한만으로는 최악 400MB+ 가능 → Render 인스턴스 메모리 위험. 총 바이트로도 퇴출.
const MEM_MAX_BYTES = Number(process.env.TTS_CACHE_MAX_BYTES || 50 * 1024 * 1024);

/** @type {Map<string, Buffer>} sha256(ssml) → mp3 Buffer (삽입순=LRU) */
const mem = new Map();
let memBytes = 0;

const stats = { hit: 0, miss: 0, set: 0, evict: 0 };

const keyFor = (ssml) =>
    crypto.createHash('sha256').update(String(ssml)).digest('hex');

/**
 * 캐시 조회. HIT 시 LRU 갱신(최근 사용으로 이동).
 * @param {string} ssml
 * @returns {Buffer|null}
 */
function get(ssml) {
    const k = keyFor(ssml);
    const v = mem.get(k);
    if (v) {
        mem.delete(k);
        mem.set(k, v); // 최근 사용으로 재삽입
        stats.hit++;
        return v;
    }
    stats.miss++;
    return null;
}

/**
 * 캐시 저장. 상한 초과 시 가장 오래된 항목(Map 첫 키) 제거.
 * @param {string} ssml
 * @param {Buffer} buf
 */
function set(ssml, buf) {
    if (!buf || !buf.length) return;
    const k = keyFor(ssml);
    const prev = mem.get(k);
    if (prev) memBytes -= prev.length;
    mem.set(k, buf);
    memBytes += buf.length;
    stats.set++;
    while (mem.size > MEM_MAX || (memBytes > MEM_MAX_BYTES && mem.size > 1)) {
        const oldestKey = mem.keys().next().value;
        memBytes -= mem.get(oldestKey).length;
        mem.delete(oldestKey);
        stats.evict++;
    }
}

/** 현재 캐시 상태 스냅샷(로깅/디버그용). */
function snapshot() {
    const total = stats.hit + stats.miss;
    const hitRate = total > 0 ? ((stats.hit / total) * 100).toFixed(1) : '0.0';
    return { size: mem.size, max: MEM_MAX, bytes: memBytes, maxBytes: MEM_MAX_BYTES, hitRate: `${hitRate}%`, ...stats };
}

// 10분마다 적중률 로깅(활동 있을 때만). unref로 프로세스 종료를 막지 않음.
let lastTotal = 0;
const logTimer = setInterval(() => {
    const total = stats.hit + stats.miss;
    if (total === lastTotal) return; // 신규 요청 없으면 스킵
    lastTotal = total;
    console.log('[TTSCache]', JSON.stringify(snapshot()));
}, 10 * 60 * 1000);
if (typeof logTimer.unref === 'function') logTimer.unref();

/** 짧은 식별자(로그 매칭용) — 같은 콘텐츠는 같은 id. */
function shortId(ssml) {
    return keyFor(ssml).slice(0, 8);
}

module.exports = { get, set, snapshot, shortId };
