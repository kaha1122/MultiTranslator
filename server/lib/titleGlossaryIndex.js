// ── 카탈로그 제목 용어집 인덱스 (K-DramaAnyLang, 2026-09-19) ────────────────────
// 무엇: 인기 상위 N편의 **12개 언어 공식 제목**만 모아 둔 읽기 전용 파생 인덱스.
//   txGlossary가 이걸 읽어 "원문에 실제로 등장하는 제목"을 찾아 번역 프롬프트에 못박는다.
//
// 왜: 종전 용어집 풀은 curation_threads 최근 30일(= Dari On-Air 작품 ~12편)뿐이라, 글에서 언급된
//   구작은 공식 영어 제목이 있어도 프롬프트에 가지 않았다. 2026-09-19 실사고: 인물 페이지 코멘트의
//   「스캔들」이 "Scandal"로 직역됐다(우리 카탈로그의 공식 영어 제목은 "The Scandal", tv/275102).
//
// 왜 인덱스인가: 매 로드마다 titles 3,000건을 읽으면 서버 재시작·TTL 만료마다 3,000 read다.
//   hidden_titles와 같은 패턴으로 **cron이 하루 1회 만들고 서버는 2~3 read로 읽는다**.
//   (사용자 결정 2026-09-19: 새 cron 만들지 말고 기존 cron-daily에 얹을 것.)
//
// 형태: kdl_index/title_glossary[_1.._n]
//   - 0번 문서: { chunks, count, at, json }   1번 이후: { json }
//   - json = JSON.stringify([{ i:'<tmdbId>', t:{ ko:'제목', en:'Title', ... } }, …]) 청크
//   - searchLower는 저장하지 않는다(로드 시 toLowerCase로 만든다 — 용량 절반).
const { kcultureDb } = require('../config/firebaseKculture');

const INDEX_PATH = 'kdl_index/title_glossary';
const CHUNK_BYTES = 700 * 1024;      // Firestore 문서 1MB 한도 대비 여유
const DEFAULT_LIMIT = 3000;

const indexPath = (i) => (i === 0 ? INDEX_PATH : `${INDEX_PATH}_${i}`);

// ── 재생성 (cron 전용) — titles 인기순 N편 → 청크 문서 ────────────────────────
async function rebuild({ limit = DEFAULT_LIMIT, quiet = false } = {}) {
    if (!kcultureDb) return { skipped: 'no_db' };
    const t0 = Date.now();
    // meta.popularity는 backfill-tmdb-meta가 채운다. 없는 문서는 결과에서 빠진다(정상).
    const snap = await kcultureDb.collection('titles')
        .orderBy('meta.popularity', 'desc')
        .limit(limit)
        .select('searchTitle', 'hidden')
        .get();

    const rows = [];
    snap.forEach((d) => {
        const x = d.data() || {};
        if (x.hidden === true) return;               // 성인물 숨김작은 용어집에서도 제외
        const t = x.searchTitle || {};
        const clean = {};
        for (const [lang, v] of Object.entries(t)) {
            const s = String(v || '').trim();
            if (s) clean[lang] = s;
        }
        if (Object.keys(clean).length) rows.push({ i: d.id, t: clean });
    });

    // 청크 분할 — JSON 문자열 길이 기준(바이트 근사)
    const chunks = [];
    let cur = [];
    let curLen = 2;
    for (const r of rows) {
        const len = JSON.stringify(r).length + 1;
        if (curLen + len > CHUNK_BYTES && cur.length) { chunks.push(cur); cur = []; curLen = 2; }
        cur.push(r); curLen += len;
    }
    if (cur.length) chunks.push(cur);

    // 이전 청크 수 — 줄어든 만큼 꼬리 문서를 지운다(유령 청크 방지)
    let prevChunks = 0;
    try {
        const h = await kcultureDb.doc(indexPath(0)).get();
        if (h.exists) prevChunks = Math.max(1, Number(h.data()?.chunks) || 1);
    } catch { /* 최초 실행 */ }

    const batch = kcultureDb.batch();
    chunks.forEach((c, i) => {
        batch.set(kcultureDb.doc(indexPath(i)), {
            json: JSON.stringify(c),
            ...(i === 0 ? { chunks: chunks.length, count: rows.length, at: new Date() } : {}),
        });
    });
    for (let i = chunks.length; i < prevChunks; i++) batch.delete(kcultureDb.doc(indexPath(i)));
    await batch.commit();

    const out = { count: rows.length, chunks: chunks.length, reads: snap.size, ms: Date.now() - t0 };
    if (!quiet) console.log(`[titleGlossaryIndex] 재생성: ${out.count}편 / ${out.chunks}청크 (${out.reads} read, ${out.ms}ms)`);
    return out;
}

// ── 로드 (서버 런타임) — 청크 수만큼 read. 실패는 fail-open(빈 배열) ──────────
async function load() {
    if (!kcultureDb) return { rows: [], reads: 0, at: null };
    const head = await kcultureDb.doc(indexPath(0)).get();
    if (!head.exists) return { rows: [], reads: 1, at: null };
    const d = head.data() || {};
    const n = Math.max(1, Number(d.chunks) || 1);
    const rows = JSON.parse(d.json || '[]');
    if (n > 1) {
        const refs = [];
        for (let i = 1; i < n; i++) refs.push(kcultureDb.doc(indexPath(i)));
        const docs = await kcultureDb.getAll(...refs);
        for (const doc of docs) {
            if (!doc.exists) continue;
            for (const r of JSON.parse(doc.data()?.json || '[]')) rows.push(r);
        }
    }
    return { rows, reads: n, at: d.at?.toDate?.() || null };
}

module.exports = { rebuild, load, INDEX_PATH, DEFAULT_LIMIT };
