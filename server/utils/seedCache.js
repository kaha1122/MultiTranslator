// ─────────────────────────────────────────────────────────────────────────
// seedCache.js — write-through seed 캐시 (vocabSeed / passageSeed)
//
// 목적(Phase 2): 같은 토픽/유닛에서 모든 유저가 같은 학습 콘텐츠를 같은 순서로 받도록
//   전역 canonical 시퀀스를 Firestore에 누적 저장. 첫 요청자만 Gemini 생성(frontier),
//   이후 전원 무료 재사용. 순서 고정(offset 슬라이스).
//
// 구조:
//   - 컬렉션 doc: { ...meta, [field]: [ ...ordered items... ], updatedAt }
//     vocabSeed/{topicId--level--src--tgt}  field='words'  (5씩 누적)
//     passageSeed/{topicId--type--level--src--tgt} field='passages' (1씩 누적)
//   - 인메모리 LRU(hot)로 Firestore 읽기 절감.
//   - append는 트랜잭션 + length 재확인으로 동시 frontier 생성 경합 차단.
//   - adminDb 미초기화(로컬) 시 안전 폴백(생성물 그대로 반환, 캐시 미사용).
// ─────────────────────────────────────────────────────────────────────────
const { admin, adminDb } = require('../config/firebase');

const MEM_MAX = Number(process.env.SEED_CACHE_MAX || 500);
const mem = new Map(); // `${col}/${key}` → doc data (삽입순 LRU)
const stats = { hit: 0, miss: 0, write: 0, raceSkip: 0 };

const memKey = (col, key) => `${col}/${key}`;

// 단어 중복 판정용 정규화 키 — lowercase·NFKC·공백 정리·흔한 구두점 제거.
// 프롬프트 회유(soft)가 새도 저장 직전 이 키로 코드가 중복을 막는다(sun×2 등 누수 차단).
function normalizeWord(s) {
    return String(s == null ? '' : s)
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s ]+/g, ' ')
        .replace(/[.,!?;:"'`´()[\]{}…·、。！？，]/g, '')
        .trim();
}

function memGet(col, key) {
    const k = memKey(col, key);
    const v = mem.get(k);
    if (v) { mem.delete(k); mem.set(k, v); } // 최근 사용으로 이동
    return v || null;
}
function memSet(col, key, data) {
    const k = memKey(col, key);
    if (mem.has(k)) mem.delete(k);
    mem.set(k, data);
    while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}

/**
 * seed 문서의 ordered items 배열 조회 (인메모리 → Firestore).
 * @returns {Promise<Array>} items (없으면 [])
 */
async function readItems(col, key, field) {
    if (!adminDb) return [];
    const cached = memGet(col, key);
    if (cached) { stats.hit++; return Array.isArray(cached[field]) ? cached[field] : []; }
    stats.miss++;
    try {
        const snap = await adminDb.collection(col).doc(key).get();
        const data = snap.exists ? snap.data() : null;
        if (data) memSet(col, key, data);
        return data && Array.isArray(data[field]) ? data[field] : [];
    } catch (e) {
        console.error(`[seedCache] read failed ${col}/${key}:`, e.message);
        return [];
    }
}

/**
 * frontier 생성물(newItems)을 seed에 append하고 [offset, offset+count) slice 반환.
 * 트랜잭션 내 length 재확인 — 다른 요청이 이미 채웠으면(length > offset) 그쪽 slice 반환(중복 쓰기 방지).
 * @param {object} [opts]
 * @param {(item:any)=>string} [opts.dedupeBy] 주어지면 이 키로 기존 시퀀스/신규 내부 중복을 append 전에 제거(하드 dedup).
 *   단어 시퀀스에만 사용(passage 등엔 미지정). dedup으로 일부가 빠지면 그 페이지 slice가 count보다 짧을 수 있음(드묾).
 * @returns {Promise<Array>} authoritative slice (length ≤ count)
 */
async function appendAndSlice(col, key, field, meta, newItems, offset, count, opts = {}) {
    if (!adminDb) return newItems.slice(0, count); // 로컬/미초기화 폴백
    const ref = adminDb.collection(col).doc(key);
    const dedupeBy = typeof opts.dedupeBy === 'function' ? opts.dedupeBy : null;
    try {
        const merged = await adminDb.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists ? snap.data() : null;
            const existing = data && Array.isArray(data[field]) ? data[field] : [];
            if (existing.length > offset) {
                // 다른 요청이 이미 frontier 채움 → 쓰기 생략, 기존 사용
                return existing;
            }
            // 하드 dedup — 기존 시퀀스 + 신규 내부 중복을 append 전에 제거(소프트 anti-dup 누수 차단).
            let toAppend = newItems;
            if (dedupeBy) {
                const seen = new Set(existing.map(dedupeBy).filter(Boolean));
                toAppend = [];
                let dropped = 0;
                for (const it of newItems) {
                    const k = dedupeBy(it);
                    if (k && seen.has(k)) { dropped++; continue; }
                    if (k) seen.add(k);
                    toAppend.push(it);
                }
                if (dropped) console.log(`[seedCache] dedup dropped ${dropped} dup item(s) ${col}/${key}`);
            }
            const next = [...existing, ...toAppend];
            tx.set(ref, {
                ...meta,
                [field]: next,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            return next;
        });
        if (merged.length > offset + newItems.length) stats.raceSkip++; else stats.write++;
        memSet(col, key, { ...meta, [field]: merged });
        return merged.slice(offset, offset + count);
    } catch (e) {
        console.error(`[seedCache] append failed ${col}/${key}:`, e.message);
        return newItems.slice(0, count); // 실패 시 생성물 직접 반환(과금됐으니 버리지 않음)
    }
}

/**
 * 배열 끝에 무조건 append(+옵션 dedup). appendAndSlice의 frontier(offset 1회 채움) 의미가 아니라
 * "공유 풀에 항목 추가" 용도 — 다른 writer가 이미 늘렸어도 내 항목을 (dedup 후) 끝에 붙인다.
 * (listening 결합 unit이 추출 단어를 vocabSeed 풀에 누적할 때 사용.)
 */
async function appendItems(col, key, field, meta, newItems, opts = {}) {
    if (!adminDb || !Array.isArray(newItems) || newItems.length === 0) return;
    const ref = adminDb.collection(col).doc(key);
    const dedupeBy = typeof opts.dedupeBy === 'function' ? opts.dedupeBy : null;
    try {
        const merged = await adminDb.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists ? snap.data() : null;
            const existing = data && Array.isArray(data[field]) ? data[field] : [];
            let toAppend = newItems;
            if (dedupeBy) {
                const seen = new Set(existing.map(dedupeBy).filter(Boolean));
                toAppend = [];
                for (const it of newItems) {
                    const k = dedupeBy(it);
                    if (k && seen.has(k)) continue;
                    if (k) seen.add(k);
                    toAppend.push(it);
                }
            }
            if (!toAppend.length) return existing;
            const next = [...existing, ...toAppend];
            tx.set(ref, {
                ...meta,
                [field]: next,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            return next;
        });
        memSet(col, key, { ...meta, [field]: merged });
    } catch (e) {
        console.error(`[seedCache] appendItems failed ${col}/${key}:`, e.message);
    }
}

const snapshot = () => ({ size: mem.size, max: MEM_MAX, ...stats });

module.exports = { readItems, appendAndSlice, appendItems, snapshot, normalizeWord };
