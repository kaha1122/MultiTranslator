// ── Gemini 발명 제목 → 영어 제목 일괄 교체 (2026-08-01 정책 전환 백필) ─────────
// 배경: 「유부녀 킬러」(294095)가 7개 언어에서 "아내 살해범"으로 오역된 사건.
//   제목은 설명이 아니라 **이름**이다 — 배급사·커뮤니티가 부여하기 전엔 존재하지 않고,
//   사이트가 발명한 제목은 검색 수요가 0이며 오역 시 신뢰만 깎는다(사용자 결정 2026-08-01).
//   → 정책: 제목은 TMDB 공식 > 영어 폴백. 현지어 제목은 발명하지 않는다.
//     (신규 파이프라인은 lib/tmdbBackfill.js가 같은 정책으로 수정됨 — 이 스크립트는 기존분 소급.)
//
// 하는 일: titles/{id}/translations/{lang} 중 제목 출처가 gemini인 것을
//   검증된 영어 제목으로 교체(source: `en-fallback+<기존 줄거리 출처>`), 루트 문서의
//   searchTitle/searchLower/metaTitleSrc 동기화 + metaOfficialPending=true
//   (→ refreshOfficialTitles가 TMDB에 공식 현지어 제목이 등록되는 대로 자동 승격).
//   **줄거리는 건드리지 않는다** — 줄거리는 설명이라 번역 제공이 맞다(정책 구분).
//
// 멱등: 교체분은 source가 en-fallback으로 바뀌므로 재실행 시 자동 skip. 중단·재실행 안전.
// 백업: 교체 전 값을 scripts/logs/replace-gemini-titles-<ts>.jsonl 에 남긴다(복구용).
//
// 사용법 (server/ 에서):
//   node scripts/replace-gemini-titles.js --dry            # 판정만(쓰기 0)
//   node scripts/replace-gemini-titles.js --id 294095      # 한 작품만(검증용)
//   node scripts/replace-gemini-titles.js                  # 전체 실행
//   옵션: --limit N(문서 수 상한) --concurrency N(기본 10)
// env: KCULTURE_SERVICE_ACCOUNT_BASE64 (server/.env)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { TARGETS, titleTainted } = require('../lib/tmdbBackfill');
const { PRIMARY_CONTENT_LANG } = require('../config/contentLang');

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const val = (f, d) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : d; };
const DRY = has('dry');
const ONLY_ID = val('id', null);
const LIMIT = parseInt(val('limit', 'Infinity'), 10) || Infinity;
const CONCURRENCY = parseInt(val('concurrency', '10'), 10) || 10;

const baseLang = (c) => String(c || '').split('-')[0];
const PRIMARY_CODE = TARGETS.find((t) => baseLang(t.code) === baseLang(PRIMARY_CONTENT_LANG))?.code || 'ko';
// 교체 검토 대상 언어 — 원제(ko)와 en 자신은 제외.
const LANGS = TARGETS.map((t) => t.code).filter((c) => c !== PRIMARY_CODE && c !== 'en');

const logDir = path.join(__dirname, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const backupPath = path.join(logDir, `replace-gemini-titles-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const backup = DRY ? null : fs.createWriteStream(backupPath, { flags: 'a' });

async function processDoc(id, root) {
    const st = root.searchTitle || {};
    const tsrcMap = root.metaTitleSrc || null;
    // metaTitleSrc가 있는 신(新) 문서는 루트만 보고 gemini 제목 유무를 알 수 있다 → 서브문서 읽기 절약.
    if (tsrcMap && !LANGS.some((c) => tsrcMap[c] === 'gemini')) return { id, skipped: true };

    const refs = [...LANGS, 'en'].map((c) => kcultureDb.doc(`titles/${id}/translations/${c}`));
    const snaps = await kcultureDb.getAll(...refs);
    const sub = {};
    snaps.forEach((s, i) => { sub[[...LANGS, 'en'][i]] = s.exists ? (s.data() || {}) : null; });

    // 영어 제목 확보 — 루트 searchTitle.en 우선, 없으면 translations/en.title.
    let enT = String(st.en || sub.en?.title || '').trim();
    if (!enT || titleTainted('en', enT)) return { id, noEn: true };

    const ups = [];
    for (const c of LANGS) {
        const d = sub[c];
        if (!d) continue;                                  // 번역 문서 자체가 없음 — 파이프라인 몫
        const tPart = String(d.source || '-').split('+')[0];
        if (tPart !== 'gemini') continue;                  // official·orig·en-fallback·수동분은 유지
        const oSrc = String(d.source || '-').split('+')[1] || '-';
        ups.push({ code: c, old: d.title || '', oSrc });
    }
    if (!ups.length) return { id, skipped: true };

    if (!DRY) {
        const batch = kcultureDb.batch();
        const nst = {}, nsl = {}, ntsrc = {};
        for (const u of ups) {
            batch.set(kcultureDb.doc(`titles/${id}/translations/${u.code}`), {
                title: enT, source: `en-fallback+${u.oSrc}`, titleReplacedAt: new Date(),
            }, { merge: true });
            nst[u.code] = enT; nsl[u.code] = enT.toLowerCase(); ntsrc[u.code] = 'en-fallback';
            backup.write(`${JSON.stringify({ id, lang: u.code, oldTitle: u.old, newTitle: enT })}\n`);
        }
        batch.set(kcultureDb.doc(`titles/${id}`), {
            searchTitle: nst, searchLower: nsl, metaTitleSrc: ntsrc,  // merge → 맵 키 병합(타 언어 보존)
            metaOfficialPending: true,   // TMDB가 공식 현지어 제목을 채우면 refreshOfficialTitles가 승격
            updatedAt: new Date(),
        }, { merge: true });
        await batch.commit();
    }
    return { id, replaced: ups.length, sample: `${ups[0].code}:"${ups[0].old}"→"${enT}"` };
}

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const t0 = Date.now();
    console.log(`[replace-gemini-titles] start ${DRY ? '(DRY)' : ''} concurrency=${CONCURRENCY}`);

    let docs = [];
    if (ONLY_ID) {
        const s = await kcultureDb.doc(`titles/${ONLY_ID}`).get();
        if (!s.exists) throw new Error(`titles/${ONLY_ID} 없음`);
        docs = [{ id: s.id, root: s.data() || {} }];
    } else {
        const snap = await kcultureDb.collection('titles')
            .select('searchTitle', 'metaTitleSrc', 'media').get();
        snap.forEach((d) => docs.push({ id: d.id, root: d.data() || {} }));
        docs = docs.slice(0, LIMIT === Infinity ? docs.length : LIMIT);
    }
    console.log(`[replace-gemini-titles] 대상 문서 ${docs.length}건`);

    const stat = { docs: 0, replacedDocs: 0, replacedLangs: 0, noEn: 0, errors: 0 };
    const noEnIds = [];
    let idx = 0;
    async function worker() {
        while (idx < docs.length) {
            const { id, root } = docs[idx++];
            try {
                const r = await processDoc(id, root);
                stat.docs++;
                if (r.replaced) {
                    stat.replacedDocs++; stat.replacedLangs += r.replaced;
                    if (stat.replacedDocs <= 20 || stat.replacedDocs % 500 === 0) {
                        console.log(`  ${id} ×${r.replaced}개 언어 — ${r.sample}`);
                    }
                } else if (r.noEn) { stat.noEn++; if (noEnIds.length < 50) noEnIds.push(id); }
            } catch (e) {
                stat.errors++;
                if (stat.errors <= 5) console.warn(`  ⚠ ${id}: ${e.message}`);
            }
            if (stat.docs % 1000 === 0) console.log(`[progress] ${stat.docs}/${docs.length} — 교체 ${stat.replacedDocs}건`);
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (backup) backup.end();

    console.log(`\n[replace-gemini-titles] DONE in ${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(stat));
    if (stat.noEn) {
        console.log(`  ⚠ 영어 제목 없음 ${stat.noEn}건 — Gemini 제목 유지(빈 제목보다 낫다). 샘플: ${noEnIds.join(', ')}`);
        console.log(`    → 이들은 다음 파이프라인 재처리(runRetry/force) 때 en 생성 후 자연 해소.`);
    }
    if (!DRY) console.log(`  백업: ${backupPath}`);
    process.exit(0);
})().catch((e) => { console.error('[replace-gemini-titles] FAIL', e); process.exit(1); });
