// ─────────────────────────────────────────────────────────────────────────
// ttsAudioCache.js — Azure TTS 오디오(mp3 Blob) 기기 영속 캐시 (IndexedDB)
//
// 목적: Azure로 합성된 모든 TTS 오디오를 앱 재시작·세션종료·날짜변경 후에도 기기에서 재생
//       → 같은 텍스트 재청취 시 Azure 호출 0 (기기당 1회만 과금).
//       ※ 2026-06-10: 기존엔 저장 카드(opts.saved)만 대상이었으나, 미저장 카드(Vocab/Translation/
//          Listening)·네이티브 폴백(Android 미지원 언어→Azure) 반복 재생이 매번 과금되던 누수를
//          막기 위해 "모든 Azure 합성"으로 확대. LRU로 자주 듣는 항목 유지, 오래된 것 퇴출.
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
// 전체 Azure TTS 풀(저장+미저장+폴백). mp3 평균 수십~수백KB → 1000이면 최대 ~60MB 내.
// 2026-06-10: 캐시 대상 확대(저장카드→전체)로 churn 증가 대비 500→1000 상향.
const MAX_ENTRIES = 1000;

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

/**
 * 단일 항목 IDB 퇴출 — 손상 블롭 self-heal 용(재생 실패 시 호출 → 다음엔 재합성).
 * best-effort, 실패해도 조용히 무시.
 */
export async function deleteCachedAudio(key) {
    try {
        const db = await openDB();
        await new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        });
    } catch { /* noop */ }
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
