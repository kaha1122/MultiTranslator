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

module.exports = { appendUnit, slugFor };
