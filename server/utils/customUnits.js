// per-user custom(직접입력) unit 저장 — 전역 seed와 분리된 개인 콘텐츠.
//   users/{uid}/customUnits/{slug} = { label, level, sourceLang, targetLang, words[], passages[], createdAt, updatedAt }
//   slug = hash(normLabel|level|src|tgt) → 같은 직접입력 주제는 단어탭/지문탭이 같은 문서에 누적(개인 풀).
//   단어는 정규화 dedup으로 중복 0. 공유 X(per-user) — Library/재학습/서버측 dedup 이력 용도.
const crypto = require('crypto');
const { admin, adminDb } = require('../config/firebase');
const seedCache = require('./seedCache');

function slugFor(label, level, sourceLang, targetLang) {
    const norm = seedCache.normalizeWord(label).slice(0, 80);
    return crypto.createHash('sha256')
        .update(`${norm}|${level}|${sourceLang}|${targetLang}`)
        .digest('hex').slice(0, 24);
}

// 생성된 unit({ words, passage })을 사용자 customUnits 문서에 누적(단어 dedup, 지문 append).
async function appendUnit(uid, meta, unit) {
    if (!adminDb || !uid) return;
    const slug = slugFor(meta.topicLabel, meta.level, meta.sourceLang, meta.targetLang);
    const ref = adminDb.collection('users').doc(uid).collection('customUnits').doc(slug);
    const words = Array.isArray(unit?.words) ? unit.words : [];
    const passage = unit?.passage && unit.passage.passage ? unit.passage : null;
    try {
        await adminDb.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists ? snap.data() : null;
            const existingWords = data && Array.isArray(data.words) ? data.words : [];
            const existingPassages = data && Array.isArray(data.passages) ? data.passages : [];
            const seen = new Set(existingWords.map(w => seedCache.normalizeWord(w?.word)).filter(Boolean));
            const newWords = words.filter(w => {
                const k = seedCache.normalizeWord(w?.word);
                if (!k || seen.has(k)) return false;
                seen.add(k);
                return true;
            });
            tx.set(ref, {
                label: meta.topicLabel || '',
                level: meta.level,
                sourceLang: meta.sourceLang,
                targetLang: meta.targetLang,
                words: [...existingWords, ...newWords],
                passages: passage ? [...existingPassages, passage] : existingPassages,
                createdAt: data?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        });
    } catch (e) {
        console.error('[customUnits] append failed:', e.message);
    }
}

// 단일 custom unit 조회 — { label, level, sourceLang, targetLang, words[], passages[] } | null.
async function getUnit(uid, slug) {
    if (!adminDb || !uid || !slug) return null;
    try {
        const snap = await adminDb.collection('users').doc(uid).collection('customUnits').doc(slug).get();
        return snap.exists ? snap.data() : null;
    } catch (e) {
        console.error('[customUnits] getUnit failed:', e.message);
        return null;
    }
}

// 노드별 활성 custom unit 포인터 — users/{uid}/activeCustomUnits/{nodeKey} = { slug, source, updatedAt }.
//   nodeKey = `${topicId}--${level}--${sourceLang}--${targetLang}` (클라 진입 단위와 동일).
//   custom generate 시 갱신(=마지막 입력이 활성). 진입 시 조회해 unit 복원.
function activeRef(uid, nodeKey) {
    return adminDb.collection('users').doc(uid).collection('activeCustomUnits').doc(nodeKey);
}

async function setActivePointer(uid, nodeKey, slug, source) {
    if (!adminDb || !uid || !nodeKey || !slug) return;
    try {
        await activeRef(uid, nodeKey).set({
            slug, source: source || 'vocab',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (e) {
        console.error('[customUnits] setActivePointer failed:', e.message);
    }
}

async function getActiveUnit(uid, nodeKey) {
    if (!adminDb || !uid || !nodeKey) return null;
    try {
        const snap = await activeRef(uid, nodeKey).get();
        if (!snap.exists) return null;
        const { slug, source } = snap.data() || {};
        if (!slug) return null;
        const unit = await getUnit(uid, slug);
        if (!unit) return null;
        // 마지막(최신) 항목 반환 — words 풀 + 최신 지문 1개.
        const passages = Array.isArray(unit.passages) ? unit.passages : [];
        return {
            slug, source,
            words: Array.isArray(unit.words) ? unit.words : [],
            passage: passages.length ? passages[passages.length - 1] : null,
            label: unit.label || '',
        };
    } catch (e) {
        console.error('[customUnits] getActiveUnit failed:', e.message);
        return null;
    }
}

module.exports = { appendUnit, slugFor, getUnit, setActivePointer, getActiveUnit };
