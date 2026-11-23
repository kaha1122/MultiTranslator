// ── [임시 진단] Render 서버에서 yt-dlp가 되는지 시험 (2026-11-23) ───────────────
// 목적: "서버가 유튜브 영상의 한 구간을 mp4로 잘라 줄 수 있는가"를 실제 서버에서 확인한다.
//   유튜브는 클라우드 서버 주소의 요청을 "로봇이 아님을 확인" 단계로 거부하는 일이 많아, 돌려 보기 전에는 알 수 없다.
// requireCronAuth(x-cron-secret) — 운영자만 호출할 수 있다. 결과만 돌려주고 받은 파일은 바로 지운다(저장·전송 없음).
// ⚠ 시험이 끝나면 이 파일과 index.js의 등록 줄을 지운다(임시 코드).
//
// POST /api/cron/diag-ytdlp  { v?: 영상 번호, s?: 시작 초, e?: 끝 초 }
// 단계: ① yt-dlp 실행 파일 준비(공식 릴리스) ② 버전 ③ 영상 정보만 읽기 ④ 그 구간만 받아 mp4로
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { requireCronAuth } = require('../middleware/auth');

const router = express.Router();
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const BIN_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const FORMAT = 'bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[ext=mp4]';

const run = (cmd, args, timeoutMs) => new Promise((resolve) => {
    const t0 = Date.now();
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({
            ok: !err, ms: Date.now() - t0, code: err ? (err.code ?? null) : 0, killed: !!err?.killed,
            out: String(stdout || '').slice(-1500), err: String(stderr || '').slice(-1500),
        });
    });
});

async function ensureBinary() {
    if (process.platform !== 'linux') return { path: 'yt-dlp', note: 'PATH의 yt-dlp 사용(리눅스 아님 — 로컬 확인용)' };
    const p = path.join(os.tmpdir(), 'yt-dlp_linux');
    if (fs.existsSync(p) && fs.statSync(p).size > 1_000_000) return { path: p, note: 'cached', bytes: fs.statSync(p).size };
    const r = await fetch(BIN_URL, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`binary download HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(p, buf, { mode: 0o755 });
    return { path: p, note: 'downloaded', bytes: buf.length };
}

router.post('/api/cron/diag-ytdlp', requireCronAuth, async (req, res) => {
    const b = req.body || {};
    const v = YT_ID.test(String(b.v || '')) ? String(b.v) : 'JNhX-QWXzFI';
    const s = Number.isFinite(Number(b.s)) && Number(b.s) >= 0 ? Math.floor(Number(b.s)) : 295;
    const e = Number.isFinite(Number(b.e)) && Number(b.e) > s && Number(b.e) - s <= 90 ? Math.floor(Number(b.e)) : s + 35;
    const url = `https://www.youtube.com/watch?v=${v}`;
    const report = { v, s, e, platform: process.platform, arch: process.arch, node: process.version, cpus: os.cpus().length, freeMemMb: Math.round(os.freemem() / 1048576), steps: {} };
    const outFile = path.join(os.tmpdir(), `diag-${v}-${Date.now()}.mp4`);
    try {
        let ffmpegPath = null;
        try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; } catch (err) { report.steps.ffmpeg = { ok: false, err: err.message }; }
        if (ffmpegPath) {
            const fv = await run(ffmpegPath, ['-version'], 15_000);
            report.steps.ffmpeg = { ok: fv.ok, version: fv.out.split('\n')[0] };
        }

        const bin = await ensureBinary();
        report.steps.binary = { ok: true, note: bin.note, bytes: bin.bytes || null };

        const ver = await run(bin.path, ['--version'], 30_000);
        report.steps.version = { ok: ver.ok, ms: ver.ms, version: ver.out.trim(), err: ver.ok ? undefined : ver.err };
        if (!ver.ok) return res.json(report);

        // ③ 영상 정보만 — 여기서 "로봇이 아님을 확인"으로 막히는지가 핵심
        const meta = await run(bin.path, ['--no-playlist', '--skip-download', '--print', '%(title)s | %(duration)s | %(format_id)s', '-f', FORMAT, url], 60_000);
        report.steps.metadata = { ok: meta.ok, ms: meta.ms, out: meta.out.trim().slice(0, 300), err: meta.ok ? undefined : meta.err };
        if (!meta.ok) return res.json(report);

        // ④ 그 구간만 받아 mp4로
        const args = ['--no-playlist', '-f', FORMAT, '--download-sections', `*${s}-${e}`, '--force-keyframes-at-cuts', '--merge-output-format', 'mp4', '-o', outFile];
        if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath);
        args.push(url);
        const dl = await run(bin.path, args, 150_000);
        const exists = fs.existsSync(outFile);
        report.steps.section = {
            ok: dl.ok && exists, ms: dl.ms, bytes: exists ? fs.statSync(outFile).size : 0, killed: dl.killed,
            tail: (dl.ok ? dl.out : `${dl.out}\n${dl.err}`).trim().slice(-900),
        };
        return res.json(report);
    } catch (err) {
        report.error = err.message;
        return res.json(report);
    } finally {
        try { for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(`diag-${v}-`)) fs.unlinkSync(path.join(os.tmpdir(), f)); } catch { /* 정리 실패는 무시 */ }
    }
});

module.exports = router;
