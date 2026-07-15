// ── 커뮤니티 UGC 글의 lang 필드 백필 보정 (1회성, 멱등) ──────────────────────
// 과거 글은 lang을 "작성자 UI 언어"로 저장해 텍스트 실제 언어와 어긋날 수 있다
// (예: UI 일본어인데 영어로 쓴 글이 ja로 저장). 이 스크립트는 각 글의 body를
// Gemini로 감지해 실제 언어로 lang을 보정한다. /api/community/detect 와 동일 로직.
//
// 대상(국기 배지가 붙는 커뮤니티 텍스트):
//   posts, posts/*/comments, */replies(양쪽), titles/*/discussion
// 제외: titles/*/reviews(평가) — 그 lang은 "언어권"이라 UI 언어가 정답(byLang 집계용).
//
// 로컬 실행 (server/.env 에 GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64 필요):
//   cd server && node scripts/backfill-community-lang.js [옵션]
// 옵션:
//   --dry            감지만 하고 write 안 함(먼저 이걸로 미리보기 권장)
//   --concurrency 6  Gemini 동시 처리 수(기본 6)
//   --limit 100      처리 상한(테스트용)
//   --collection posts|comments|discussion|replies   특정 종류만(기본 전부)
// 멱등: 이미 정확한 글(감지=저장값)은 write 스킵. 중단 후 재실행해도 안전.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { kcultureDb } = require('../config/firebaseKculture');
const { callGeminiText } = require('../utils/geminiCall');
const { buildDetectPrompt, parseDetected } = require('../lib/langDetect');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const DRY = process.argv.includes('--dry');
const CONCURRENCY = parseInt(arg('concurrency', '6'), 10);
const LIMIT = arg('limit') ? parseInt(arg('limit'), 10) : Infinity;
const ONLY = arg('collection', null); // posts|comments|discussion|replies

// 텍스트의 실제 언어 감지 — /api/community/detect 와 동일 로직(lib/langDetect 공유). 실패/모호 시 null.
async function detectLang(text) {
    const t = (text || '').trim();
    const letters = (t.match(/\p{L}/gu) || []).length;
    if (letters < 2) return null; // 초단문·이모지·숫자만 → 스킵
    const r = await callGeminiText(buildDetectPrompt(t), GEMINI_API_KEY, {
        label: 'backfill-detect',
        genConfig: { temperature: 0, topP: 0.9, responseMimeType: 'application/json' },
    });
    if (r.error) throw new Error(r.userMsg || r.error);
    return parseDetected(r.text);
}

// 처리 대상 doc 수집 — {ref, body, lang, kind}
async function collectTargets() {
    const targets = [];
    const want = (k) => !ONLY || ONLY === k;
    const push = (snap, kind) => {
        for (const d of snap.docs) {
            const data = d.data() || {};
            if (data.deleted) continue;            // tombstone 스킵
            if (!data.body || !String(data.body).trim()) continue; // 본문 없음(이미지 전용 등) 스킵
            targets.push({ ref: d.ref, body: String(data.body), lang: data.lang || null, kind });
        }
    };
    if (want('posts')) push(await kcultureDb.collection('posts').get(), 'posts');
    if (want('comments')) push(await kcultureDb.collectionGroup('comments').get(), 'comments');       // posts/*/comments
    if (want('discussion')) push(await kcultureDb.collectionGroup('discussion').get(), 'discussion'); // titles/*/discussion
    if (want('replies')) push(await kcultureDb.collectionGroup('replies').get(), 'replies');          // posts & titles 양쪽
    return targets;
}

// 동시성 제한 워커 풀
async function runPool(items, worker, concurrency) {
    let idx = 0;
    const runNext = async () => {
        while (idx < items.length) {
            const i = idx++;
            await worker(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
}

(async () => {
    if (!GEMINI_API_KEY) { console.error('[backfill-lang] GEMINI_API_KEY 없음'); process.exit(1); }
    if (!kcultureDb) { console.error('[backfill-lang] kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요'); process.exit(1); }

    console.log('[backfill-lang] start', { DRY, CONCURRENCY, LIMIT, ONLY: ONLY || 'all' });
    const t0 = Date.now();
    let all = await collectTargets();
    if (Number.isFinite(LIMIT)) all = all.slice(0, LIMIT);
    console.log(`[backfill-lang] 대상 ${all.length}건 수집`);

    const stat = { scanned: 0, changed: 0, same: 0, undetected: 0, error: 0 };
    await runPool(all, async (it) => {
        stat.scanned++;
        let detected = null;
        try { detected = await detectLang(it.body); }
        catch (e) { stat.error++; console.warn(`  ✗ [${it.kind}] ${it.ref.path} detect 실패: ${e.message}`); return; }
        if (!detected) { stat.undetected++; return; }            // 모호/초단문 → 손대지 않음
        if (detected === it.lang) { stat.same++; return; }        // 이미 정확 → 스킵(멱등)
        console.log(`  ~ [${it.kind}] ${it.ref.path}: ${it.lang || '(none)'} → ${detected}  "${it.body.slice(0, 24).replace(/\n/g, ' ')}"`);
        if (!DRY) { try { await it.ref.update({ lang: detected }); stat.changed++; } catch (e) { stat.error++; console.warn(`  ✗ update 실패: ${e.message}`); } }
        else { stat.changed++; }
    }, CONCURRENCY);

    console.log(`[backfill-lang] DONE in ${Math.round((Date.now() - t0) / 1000)}s`, stat, DRY ? '(DRY — write 안 함)' : '');
    process.exit(0);
})().catch((e) => { console.error('[backfill-lang] FAIL', e); process.exit(1); });
