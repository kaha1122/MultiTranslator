// customUnitSession — 직접입력(custom) 결합 unit(단어+지문)의 노드 단위 영속 세션 (localStorage).
//   목적: ① vocab custom generate → Listening 진입 시 같은 unit 지문 표시(정방향)
//         ② listening custom generate → Vocab 진입 시 같은 unit 단어 표시(역방향)
//         ③ 노드 나갔다 재진입 시 직전 custom 세션 복원(단어/지문 그대로, 재생성 X)
//   키: 노드(topicId)+level+lang. 같은 노드의 vocab/listening 탭이 같은 키를 계산해 공유.
//   per-device(localStorage). Firestore customUnits(전역 영구 dedup 풀)와 별개의 "활성 세션 포인터".
//   모든 작업 try/catch → 실패해도 학습 흐름 안 깨짐(없으면 기존 generate 동작).
const KEY_PREFIX = 'customUnit:';

function keyFor(topicId, level, lang) {
    return `${KEY_PREFIX}${topicId}--${level}--${lang}`;
}

// 저장 — { words[], passage(객체|null), label, savedAt }. words/passage 둘 중 있는 것만 병합 갱신.
export function saveCustomUnitSession(topicId, level, lang, { words, passage, label } = {}) {
    if (!topicId) return;
    try {
        const k = keyFor(topicId, level, lang);
        let prev = {};
        try { prev = JSON.parse(localStorage.getItem(k) || '{}'); } catch { prev = {}; }
        const next = {
            words: Array.isArray(words) && words.length ? words : (prev.words || null),
            passage: passage || prev.passage || null,
            label: label || prev.label || '',
            savedAt: Date.now(),
        };
        localStorage.setItem(k, JSON.stringify(next));
    } catch { /* 쿼터/직렬화 실패 무시 */ }
}

// 조회 — { words, passage, label } | null. 없으면 null(기존 generate 경로).
export function loadCustomUnitSession(topicId, level, lang) {
    if (!topicId) return null;
    try {
        const raw = localStorage.getItem(keyFor(topicId, level, lang));
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || (!Array.isArray(obj.words) && !obj.passage)) return null;
        return obj;
    } catch { return null; }
}

// 노드의 custom 세션 제거 — preset(seed) 단어/지문 생성으로 전환 시 호출(custom 흔적 정리).
export function clearCustomUnitSession(topicId, level, lang) {
    if (!topicId) return;
    try { localStorage.removeItem(keyFor(topicId, level, lang)); } catch { /* noop */ }
}
