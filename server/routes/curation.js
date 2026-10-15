// ── K-DramaAnyLang Dari AI 큐레이터 게시 (운영자 전용) ───────────────────────
// POST /api/curation/publish — 회차 토론 스레드/큐레이터 리뷰 글을 kculture Firestore에 게시.
// 인증: x-curation-secret 헤더 = env CURATION_ADMIN_SECRET (fail-closed — 미설정 시 503,
//   requireCronAuth와 동일 설계·timing-safe 비교). 사용자 토큰 아님 — 운영자/스케줄러 전용.
// 실 게시 로직은 lib/dari.js (scripts/dari-publish.js CLI와 공용).
//
// 2026-09-09 확장 — 클라우드 루틴(Claude Code routines)이 이 엔드포인트로 게시한다.
//   클라우드 세션에는 server/.env가 없다. 대신 클라우드 환경의 API credential이
//   multitranslator.onrender.com 행 요청에 x-curation-secret을 세션 밖에서 붙여 준다.
//   그래서 CLI(dari-publish.js · dari-review.js · dari-feature.js)가 받는 옵션을 여기서도
//   전부 받아야 한다 — 종전에는 tmdbId/season/episodes/dryRun만 받아 clip·pre·body·rebody가
//   빠졌고, 리뷰는 v1(Gemini 번역)만 받아 14개 언어 직접 집필분(v2)을 게시할 수 없었다.
//
//   type
//     episode_thread  createEpisodeThread 전 옵션 통과 (clip·clipEp·pre·body·rebody·hook·rehook·reseed·backdate)
//     review          v1 — title/body → Gemini 시드 (종전 그대로)
//     review_v2       bodies/titles/glossary — 14개 언어 직접 집필, Gemini 미호출
//   ⚠ review·review_v2는 **작품당 1편 가드**가 있다(2026-09-16 중복 게시 사고) — 같은 (titleId, media)의
//     curator 글이 있으면 `result.skipped:'exists'` + 기존 postId를 돌려주고 아무것도 쓰지 않는다.
//     응답을 다시 보고 싶어서 같은 페이로드를 재전송해도 이제 안전하다. 의도적 2편째만 `force:true`.
//     feature         dari-feature.js 동형: list · config · auto · targets · auto-on/off · pin/unpin · rank/clear
const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { ensureDariAccount, createEpisodeThread, createReviewPost } = require('../lib/dari');
const { kcultureDb } = require('../config/firebaseKculture');
const { runFeaturedDaily, getFeaturedConfig } = require('../lib/kcultureFeatured');

const router = express.Router();
const CURATION_ADMIN_SECRET = process.env.CURATION_ADMIN_SECRET || '';

// 운영자 인증 (middleware/auth.js requireCronAuth와 동일 패턴 — fail-closed + timing-safe)
function requireCurationAuth(req, res, next) {
    if (!CURATION_ADMIN_SECRET) {
        console.error('[CurationAuth] CURATION_ADMIN_SECRET not set — rejecting (fail-closed)');
        return res.status(503).json({ error: 'Curation auth not configured' });
    }
    const key = req.headers['x-curation-secret'] || '';
    const a = Buffer.from(key);
    const b = Buffer.from(CURATION_ADMIN_SECRET);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    return res.status(401).json({ error: 'Unauthorized curation request' });
}

const posInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

// 인증 확인용 — 클라우드 환경의 credential 주입이 되는지 curl 한 줄로 검증한다(부작용 없음).
router.get('/api/curation/ping', requireCurationAuth, (req, res) => res.json({ ok: true, at: new Date().toISOString() }));

router.post('/api/curation/publish', requireCurationAuth, async (req, res) => {
    const b = req.body || {};
    try {
        // ── 회차 토론 스레드 / 선공개 스레드 ────────────────────────────────
        if (b.type === 'episode_thread') {
            await ensureDariAccount();
            const episodes = Array.isArray(b.episodes) ? b.episodes.map(Number) : [];
            const season = posInt(b.season) || 1;
            // CLI --clip <videoId> --clip-ep <N> 과 같은 모양. clipEp 없으면 lib가 상한 회차로 귀속한다.
            const clip = b.clip ? { videoId: String(b.clip), ep: posInt(b.clipEp) || undefined } : null;
            const bodyOverride = typeof b.body === 'string' && b.body.trim() ? b.body.trim() : null;
            if (bodyOverride && bodyOverride.length > 6000) return res.status(400).json({ error: 'body가 6,000자를 넘습니다(브리핑은 2,000~4,000자 권장)' });
            if (b.pre && !bodyOverride) return res.status(400).json({ error: 'pre 스레드는 body(브리핑)가 필요합니다' });
            if (b.rebody && !bodyOverride) return res.status(400).json({ error: 'rebody는 body가 필요합니다' });
            if (b.rehook && !b.hook) return res.status(400).json({ error: 'rehook은 hook이 필요합니다' });
            const r = await createEpisodeThread({
                tmdbId: Number(b.tmdbId),
                season,
                episodes,
                dryRun: !!b.dryRun,
                reseed: !!b.reseed,
                backdate: b.backdate || null,
                hook: typeof b.hook === 'string' && b.hook.trim() ? b.hook.trim() : null,
                rehook: !!b.rehook,
                clip,
                bodyOverride,
                rebody: !!b.rebody,
                pre: !!b.pre,
            });
            console.log(`[Curation] episode_thread tmdbId=${b.tmdbId} s${season} eps=${episodes.join(',')}${b.pre ? ' PRE' : ''}${b.rebody ? ' REBODY' : ''}${clip ? ` clip=${clip.videoId}` : ''} → ${r.skipped ? 'SKIP(존재)' : r.dryRun ? 'DRY' : 'OK'} ${r.path}`);
            return res.json({ ok: true, result: r });
        }

        // ── 리뷰 v1 (종전 — Gemini 번역 시드) ───────────────────────────────
        if (b.type === 'review') {
            await ensureDariAccount();
            const r = await createReviewPost({
                tmdbId: Number(b.tmdbId),
                media: b.media,
                title: b.title,
                body: b.body,
                spoilerBody: b.spoilerBody || null,
                glossary: b.glossary || null,
                dryRun: !!b.dryRun,
                force: !!b.force,
            });
            console.log(`[Curation] review tmdbId=${b.tmdbId} media=${b.media} → ${r.skipped ? `SKIP(존재) posts/${r.postId}` : r.dryRun ? 'DRY' : `OK posts/${r.postId}`}`);
            return res.json({ ok: true, result: r });
        }

        // ── 리뷰 v2 — 14개 언어 직접 집필분 (dari-review.js --file <v2.json> 과 동일) ──
        // 검증(언어 누락 등)은 lib/dari.js createReviewPost가 SEED_LANGS 기준으로 한다.
        if (b.type === 'review_v2') {
            if (!b.bodies || typeof b.bodies !== 'object') return res.status(400).json({ error: 'bodies {lang: body} 필요' });
            await ensureDariAccount();
            const r = await createReviewPost({
                tmdbId: Number(b.tmdbId),
                media: b.media,
                title: b.titles?.en || b.title,
                body: b.bodies.en || b.body,
                bodies: b.bodies,
                titles: b.titles || null,
                spoilerBody: b.spoilerBody || null,
                glossary: b.glossary || null,
                dryRun: !!b.dryRun,
                force: !!b.force,
            });
            console.log(`[Curation] review_v2 tmdbId=${b.tmdbId} media=${b.media} langs=${Object.keys(b.bodies).length} → ${r.skipped ? `SKIP(존재) posts/${r.postId}` : r.dryRun ? 'DRY' : `OK posts/${r.postId}`}`);
            return res.json({ ok: true, result: r });
        }

        // ── featured 운영 — scripts/dari-feature.js 와 동형 ─────────────────
        if (b.type === 'feature') {
            if (!kcultureDb) return res.status(503).json({ error: 'kcultureDb 없음' });
            const cfgRef = kcultureDb.doc('config/kc_featured');
            const op = String(b.op || '');
            if (op === 'list') {
                const snap = await kcultureDb.collection('curation_threads').get();
                const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                    .sort((x, y) => ((x.featured ?? 999) - (y.featured ?? 999)))
                    .map((x) => ({ id: x.id, title: x.title, featured: x.featured ?? null, pin: !!x.featuredPin, pre: !!x.pre }));
                return res.json({ ok: true, rows });
            }
            if (op === 'config') return res.json({ ok: true, config: await getFeaturedConfig() });
            if (op === 'auto') {
                const r = await runFeaturedDaily(new Date(), { dryRun: !!b.dryRun, force: true });
                console.log(`[Curation] feature auto${b.dryRun ? ' DRY' : ''}`);
                return res.json({ ok: true, result: r });
            }
            if (op === 'targets') {
                const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
                await cfgRef.set({ targetIds: ids, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                console.log(`[Curation] feature targets ${ids.length}건`);
                return res.json({ ok: true, targetIds: ids });
            }
            if (op === 'auto-on' || op === 'auto-off') {
                await cfgRef.set({ autoEnabled: op === 'auto-on', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                return res.json({ ok: true, autoEnabled: op === 'auto-on' });
            }
            // 아래는 스레드 문서 대상
            const id = String(b.thread || '');
            const ref = kcultureDb.doc(`curation_threads/${id}`);
            if (!id || !(await ref.get()).exists) return res.status(404).json({ error: `없음: curation_threads/${id}` });
            if (op === 'pin') { await ref.update({ featuredPin: true }); return res.json({ ok: true, id, pin: true }); }
            if (op === 'unpin') { await ref.update({ featuredPin: admin.firestore.FieldValue.delete() }); return res.json({ ok: true, id, pin: false }); }
            if (op === 'clear') { await ref.update({ featured: admin.firestore.FieldValue.delete() }); return res.json({ ok: true, id, featured: null }); }
            if (op === 'rank') {
                const rank = posInt(b.rank);
                if (!rank) return res.status(400).json({ error: 'rank: 1 이상의 정수' });
                await ref.update({ featured: rank });
                console.log(`[Curation] feature rank ${id} → ${rank} (다음 05시 자동 배치에서 재선정 — 유지하려면 pin)`);
                return res.json({ ok: true, id, featured: rank });
            }
            return res.status(400).json({ error: "op: list | config | auto | targets | auto-on | auto-off | pin | unpin | rank | clear" });
        }

        return res.status(400).json({ error: "type: 'episode_thread' | 'review' | 'review_v2' | 'feature'" });
    } catch (e) {
        console.error(`[Curation] FAIL type=${b.type}:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── 작품 가이드 게시 (2026-10-16 — 클라우드 자동 배치용) ─────────────────────
// POST /api/curation/guide  { op: 'publish' | 'unpublish' | 'status', guide?, titleId?, dryRun? }
//   publish   = KCulture scripts/publish-guide.mjs --apply 와 같은 문서를 원자적으로 쓴다:
//               titles/{id}/guide/{lang} ×14 · titles/{id}/guide/_meta · guide_index/all.titles.{id}
//               자동 관문(guide-check + guide-qa)을 통과한 편만 오므로 verified:true·verifiedBy:'auto'로 기록한다.
//   unpublish = 위 문서를 지우고 인덱스에서 뺀다(사고 시 되돌리기).
//   status    = titleId 없으면 { autopublish }(배치 사전 점검), 있으면 인덱스 항목·언어 문서 수(부작용 없음).
// 정지 스위치: env GUIDE_AUTOPUBLISH=off → publish 423 · status autopublish:false(배치가 작성 전에 멈춘다).
// Firestore 변경은 배포를 일으키지 않는다 — 호출자가 KCulture content/guides/published.json을 커밋·푸시해 재빌드한다.
const GUIDE_LANGS = ['ko', 'en', 'ja', 'zh-CN', 'th', 'vi', 'id', 'ar', 'ru', 'de', 'fr', 'es', 'pt-BR', 'it'];
const GUIDE_REQUIRED = ['summary', 'relLine', 'titleWord', 'titleMeaning', 'chart'];
const guideAutopublish = () => String(process.env.GUIDE_AUTOPUBLISH || '').toLowerCase() !== 'off';

function guideTypeErrors(t) {
    const errs = [];
    const str = (v, p, opt = true) => { if (v == null ? !opt : typeof v !== 'string') errs.push(`${p}: 문자열이어야 함`); };
    for (const k of ['summary', 'relLine', 'titleWord', 'titleMeaning', 'context', 'runtime', 'original', 'asOf', 'endingType', 'ending']) str(t[k], k);
    (t.badges || []).forEach((b, i) => str(b, `badges[${i}]`, false));
    (t.points || []).forEach((p, i) => str(p && p.text, `points[${i}].text`, false));
    (t.crew || []).forEach((c, i) => str(c && c.alsoWork, `crew[${i}].alsoWork`));
    if (t.quote) { str(t.quote.text, 'quote.text'); str(t.quote.speaker, 'quote.speaker'); }
    const c = t.chart;
    if (c && typeof c === 'object') {
        for (const k of ['leadLink', 'topLink', 'unit', 'targetLink', 'target', 'legend']) str(c[k], `chart.${k}`);
        const nodes = [...(c.leads || []), ...(c.top ? [c.top] : []), ...(c.members || []), ...(c.groups || []).flatMap((x) => (x && x.members) || [])];
        nodes.forEach((n, i) => { if (!n || typeof n !== 'object') errs.push(`chart.node[${i}]: 인물 객체 아님`); else for (const k of ['name', 'actor', 'role', 'rel', 'tag']) str(n[k], `chart.node[${i}].${k}`); });
    }
    return errs;
}

function validateGuide(g) {
    const errs = [];
    if (!g || typeof g !== 'object') return ['guide 객체 필요'];
    if (!posInt(g.titleId)) errs.push('titleId: 양의 정수');
    if (!['tv', 'movie'].includes(g.media)) errs.push("media: 'tv' | 'movie'");
    if (!g.slug || !/^[a-z0-9-]+$/.test(g.slug)) errs.push('slug: 소문자·숫자·하이픈');
    if (!g.template) errs.push('template 없음');
    if (!g.facts || typeof g.facts !== 'object') errs.push('facts 없음');
    const i18n = g.i18n || {};
    for (const l of GUIDE_LANGS) {
        const t = i18n[l];
        if (!t) { errs.push(`${l}: 언어 없음`); continue; }
        for (const k of GUIDE_REQUIRED) if (!t[k]) errs.push(`${l}.${k}: 비어 있음`);
        // UGC 번역 사고(2026-09-05)와 같은 이중 가드 — 서식만 남고 내용이 없는 필드를 막는다
        if (t.summary && String(t.summary).replace(/[\s\p{P}\p{S}]/gu, '').length < 20) errs.push(`${l}.summary: 본문이 비어 있음`);
        // 화면이 텍스트로 출력하는 필드에 객체가 들어가면 상세 페이지가 통째로 죽는다(2026-10-16 닥터X — chart.target 객체).
        // 앱 1.4.24 번들은 target을 문자열로만 그린다 → 문자열 강제. 나머지 표시 필드도 문자열/null만.
        for (const e of guideTypeErrors(t)) errs.push(`${l}.${e}`);
    }
    const extra = Object.keys(i18n).filter((l) => !GUIDE_LANGS.includes(l));
    if (extra.length) errs.push(`알 수 없는 언어: ${extra.join(',')}`);
    return errs;
}

router.post('/api/curation/guide', requireCurationAuth, async (req, res) => {
    const b = req.body || {};
    try {
        if (!kcultureDb) return res.status(503).json({ error: 'kcultureDb 없음' });
        const op = String(b.op || '');
        const indexRef = kcultureDb.doc('guide_index/all');

        if (op === 'status') {
            const id = String(posInt(b.titleId) || '');
            if (!id) return res.json({ ok: true, autopublish: guideAutopublish() });
            const [idx, docs] = await Promise.all([indexRef.get(), kcultureDb.collection(`titles/${id}/guide`).get()]);
            return res.json({ ok: true, autopublish: guideAutopublish(), titleId: id, index: idx.exists ? (idx.data().titles || {})[id] || null : null, docs: docs.size });
        }

        if (op === 'publish') {
            if (!guideAutopublish()) return res.status(423).json({ error: 'GUIDE_AUTOPUBLISH=off — 가이드 게시 정지 중' });
            const g = b.guide;
            const errs = validateGuide(g);
            if (errs.length) return res.status(422).json({ error: '검증 실패', errors: errs.slice(0, 30) });
            const id = String(g.titleId);
            const now = new Date().toISOString();
            const common = { titleId: Number(g.titleId), media: g.media, template: g.template, asOf: g.asOf || null, verified: true, verifiedBy: 'auto', publishedAt: now };
            const entry = { langs: GUIDE_LANGS, verified: true, slug: g.slug, asOf: g.asOf || null, publishedAt: now };
            if (b.dryRun) return res.json({ ok: true, dryRun: true, titleId: id, langs: GUIDE_LANGS.length, entry });
            const batch = kcultureDb.batch();
            for (const l of GUIDE_LANGS) batch.set(kcultureDb.doc(`titles/${id}/guide/${l}`), { ...common, lang: l, ...g.i18n[l] });
            batch.set(kcultureDb.doc(`titles/${id}/guide/_meta`), { ...common, slug: g.slug, langs: GUIDE_LANGS, facts: g.facts || null, sources: g.sources || [] });
            batch.set(indexRef, { titles: { [id]: entry }, updatedAt: now }, { merge: true });
            await batch.commit();
            console.log(`[Curation] guide publish ${g.slug} (titles/${id}/guide) 14개 언어`);
            return res.json({ ok: true, titleId: id, slug: g.slug, entry });
        }

        if (op === 'unpublish') {
            const id = String(posInt(b.titleId) || '');
            if (!id) return res.status(400).json({ error: 'titleId 필요' });
            const docs = await kcultureDb.collection(`titles/${id}/guide`).get();
            if (b.dryRun) return res.json({ ok: true, dryRun: true, titleId: id, docs: docs.size });
            const batch = kcultureDb.batch();
            docs.forEach((d) => batch.delete(d.ref));
            batch.set(indexRef, { titles: { [id]: admin.firestore.FieldValue.delete() }, updatedAt: new Date().toISOString() }, { merge: true });
            await batch.commit();
            console.log(`[Curation] guide unpublish titles/${id}/guide (${docs.size}건)`);
            return res.json({ ok: true, titleId: id, deleted: docs.size });
        }

        return res.status(400).json({ error: "op: 'publish' | 'unpublish' | 'status'" });
    } catch (e) {
        console.error(`[Curation] guide FAIL op=${b.op}:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
