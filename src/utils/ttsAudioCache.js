// ─────────────────────────────────────────────────────────────────────────
// ttsAudioCache.js — Azure TTS 오디오(mp3 Blob) 기기 영속 캐시 (IndexedDB)
//
// 목적: **저장 카드(SavedCard)** 처럼 "단어장에 담아 두고 매일 다시 듣는" 학습 콘텐츠를,
//       앱 재시작·날짜 변경 후에도 기기 저장 오디오로 재생 → 재청취 시 Azure 호출 0.
//       ※ 일반 생성 카드(다시 안 볼 확률 높음)는 이 캐시를 쓰지 않음(세션 메모리만).
//          → 저장 카드 발음이 생성 카드 churn 에 밀려 퇴출되는 일이 없도록 전용 풀.
//
// 특성:
//   - 키: handleSpeak 의 cacheKey (`${langCode}:${emotion}:${text}`) 동일 사용
//   - LRU: lastUsed 기준. 항목 수 MAX_ENTRIES 초과 시 가장 오래 안 쓰인 것부터 삭제
//     → 자주 듣는 저장 카드는 유지(매일 들으면 최근사용이라 안 밀림), 안 듣는 건 퇴출.
//   - 모든 작업 try/catch + 실패 시 null/no-op → 재생 흐름 절대 깨지지 않음(네트워크 폴백).
//   - 브라우저/WebView 에 indexedDB 없으면 전체 비활성(폴백).
// ─────────────────────────────────────────────────────────────────────────
const DB_NAME = 'pronunfit-tts';
const STORE = 'audio';
// 저장 카드 전용 풀. 카드당 단어+예문 ≈ 2항목 → 500이면 약 250장.
// mp3 평균 수십~수백KB → 최대 ~30MB 내 자동 상한.
const MAX_ENTRIES = 500;

let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        try {
            if (typeof indexedDB === 'undefined') { reject(new Error('no-indexeddb')); return; }
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const store = db.createObjectStore(STORE, { keyPath: 'key' });
                    store.createIndex('lastUsed', 'lastUsed');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
    });
    return dbPromise;
}

/**
 * 캐시 조회. HIT 시 lastUsed 갱신(LRU touch). 실패/미스 시 null.
 * @returns {Promise<Blob|null>}
 */
export async function getCachedAudio(key) {
    try {
        const db = await openDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const req = store.get(key);
            req.onsuccess = () => {
                const rec = req.result;
                if (rec && rec.blob) {
                    rec.lastUsed = Date.now();
                    try { store.put(rec); } catch { /* touch 실패 무시 */ }
                    resolve(rec.blob);
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => resolve(null);
        });
    } catch { return null; }
}

/**
 * 캐시 저장 + 상한 초과 시 LRU 퇴출. 실패해도 조용히 무시.
 */
export async function putCachedAudio(key, blob) {
    if (!blob || !blob.size) return;
    try {
        const db = await openDB();
        await new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put({ key, blob, lastUsed: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        });
        evictIfNeeded(db);
    } catch { /* 저장 실패(쿼터 등) → 무시, 다음엔 네트워크 폴백 */ }
}

/** 항목 수가 MAX_ENTRIES 초과면 lastUsed 오래된 순으로 삭제. best-effort. */
function evictIfNeeded(db) {
    try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const countReq = store.count();
        countReq.onsuccess = () => {
            let over = countReq.result - MAX_ENTRIES;
            if (over <= 0) return;
            const cursorReq = store.index('lastUsed').openCursor(); // 오래된 것부터(오름차순)
            cursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && over > 0) {
                    try { cursor.delete(); } catch { /* noop */ }
                    over -= 1;
                    cursor.continue();
                }
            };
        };
    } catch { /* noop */ }
}
