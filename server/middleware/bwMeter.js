// ── 라우트별 응답 바이트 계측 (2026-07-30) ───────────────────────────────────
// 목적: Render "Included Bandwidth"(2026-08-01부터 Hobby 포함량 100GB→5GB)의 실제
//   소비처를 라우트 단위로 확정한다. Render 대시보드는 서비스 단위까지만 보여주므로
//   "1.5GB가 어느 엔드포인트에서 나갔는가"는 여기서만 알 수 있다.
//
// ⚠ 측정값 해석 주의 2가지:
//   ① Content-Length는 **압축 전** 크기. Render 프록시가 brotli를 걸므로 실제 청구는
//      대략 1/3~1/5이다(실측: /api/news 29.6KB → 11KB). 절대량이 아니라 **라우트 간
//      상대 비중** 판정용으로 볼 것.
//   ② Content-Length가 없는 응답(스트리밍 등)은 바이트가 0으로 잡힌다 → 별도로 `nolen`
//      건수를 세어 "측정 못 한 응답이 얼마나 되는지"를 함께 노출한다. nolen이 큰 라우트가
//      보이면 그 라우트만 따로 계측 방식을 바꾸면 된다.
//
// 비용: 프로세스 메모리에 Map 1개(키 = 정규화 경로, 수십 개 수준). Firestore write 0,
//   외부 호출 0 → 대역폭·과금에 스스로 영향을 주지 않는다.
// 수명: 프로세스 재시작(배포 등)마다 초기화. 그래서 1시간마다 로그로 흘려 히스토리를 남긴다.

const stats = new Map(); // key → { n, bytes, nolen }
const startedAt = Date.now();

// 경로 정규화: 앞 4구간까지만 + 숫자 구간은 :id로. (/api/tmdb/title/tv/87739 → /api/tmdb/title/tv)
const keyOf = (p) => p.split('?')[0].split('/').slice(0, 5)
    .map((s) => (/^\d+$/.test(s) ? ':id' : s)).join('/') || '/';

function bwMeter(req, res, next) {
    res.on('finish', () => {
        const k = keyOf(req.path);
        const e = stats.get(k) || { n: 0, bytes: 0, nolen: 0 };
        const len = Number(res.get('content-length') || 0);
        e.n += 1;
        e.bytes += len;
        if (!len) e.nolen += 1;
        stats.set(k, e);
    });
    next();
}

// 상위 N개 스냅샷(바이트 내림차순) — 로그·엔드포인트 공용
function bwReport(top = 20) {
    const rows = [...stats.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, top);
    const totalBytes = [...stats.values()].reduce((a, e) => a + e.bytes, 0);
    const mb = (b) => Number((b / 1048576).toFixed(2));
    return {
        sinceISO: new Date(startedAt).toISOString(),
        uptimeHours: Number(((Date.now() - startedAt) / 3600000).toFixed(1)),
        totalMB: mb(totalBytes),
        routes: rows.map(([path, e]) => ({
            path, requests: e.n, mb: mb(e.bytes),
            avgKB: Number((e.bytes / e.n / 1024).toFixed(1)),
            share: totalBytes ? Number((100 * e.bytes / totalBytes).toFixed(1)) : 0,
            nolen: e.nolen || undefined, // Content-Length 없던 응답 수(측정 누락분)
        })),
    };
}

// 1시간마다 상위 12개를 한 줄 로그로. unref — 이 타이머가 프로세스 종료를 붙잡지 않게.
const timer = setInterval(() => {
    const r = bwReport(12);
    if (!r.routes.length) return;
    console.log(`[bw] ${r.totalMB}MB / ${r.uptimeHours}h |`,
        r.routes.map((x) => `${x.path} ${x.mb}MB×${x.requests}`).join(' | '));
}, 60 * 60 * 1000);
timer.unref?.();

module.exports = { bwMeter, bwReport };
