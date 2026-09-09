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
            });
            console.log(`[Curation] review tmdbId=${b.tmdbId} media=${b.media} → ${r.dryRun ? 'DRY' : `OK posts/${r.postId}`}`);
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
            });
            console.log(`[Curation] review_v2 tmdbId=${b.tmdbId} media=${b.media} langs=${Object.keys(b.bodies).length} → ${r.dryRun ? 'DRY' : `OK posts/${r.postId}`}`);
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

module.exports = router;
