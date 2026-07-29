// ── K-뉴스 보강 워커 (구글 429 없는 IP에서 실행 — GH Actions / 로컬 PC) ────────
// 배경: Render 공유 DC IP는 news.google.com 기사 페이지에서 상시 429(봇월)라
//       서버는 디코드를 포기(decodeBudget 0). 이 워커가 다른 IP에서:
//   ① GET /api/news?lang → 아직 구글 URL이거나 이미지 없는 아이템 수집
//   ② 구글 원문 URL 디코드(2단계: 기사 페이지 sg/ts → batchexecute) — 직렬+간격+서킷
//   ③ 원문 페이지 og:image 스크레이프 — 실패 시(퍼블리셔 WAF 403 등) 구글 뉴스
//      '웹 검색' 페이지의 기사별 썸네일(/api/attachments → 302 → 공개 gstatic)로 폴백
//   ④ POST /api/news/enrich 로 서버 캐시에 패치(x-cron-secret 인증)
// 의존성 0 (Node 18+ 전역 fetch) — GH Actions에서 checkout+node 만으로 실행.
//
// 실행: NEWS_CRON_SECRET=<CRON_SECRET> node server/scripts/news-enrich-worker.js
// env:  NEWS_API_BASE (기본 https://multitranslator.onrender.com)
//       NEWS_LANGS    (기본 전체 12개, 콤마 구분)
//       NEWS_DECODE_PER_LANG (기본 10)
const crypto = require('crypto');

const API = process.env.NEWS_API_BASE || 'https://multitranslator.onrender.com';
const SECRET = process.env.NEWS_CRON_SECRET || process.env.CRON_SECRET;
const LANGS = (process.env.NEWS_LANGS || 'ko,en,ja,zh-CN,vi,fr,de,es,ru,pt-BR,id,ar').split(',');
const DECODE_PER_LANG = parseInt(process.env.NEWS_DECODE_PER_LANG || '10', 10);
// 런당 전역 디코드 예산 — GH 러너 실측: ~37건(≈74요청)에서 429. 30건이면 매 런 무-429로
// 종료하고, 언어 순서 회전과 합쳐 몇 런 안에 전 언어가 채워짐(2h 주기 × 30 = 360/일 ≫ 신규 기사량).
const GLOBAL_DECODE_BUDGET = parseInt(process.env.NEWS_GLOBAL_DECODE || '30', 10);
const GAP_MS = 600;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const HEADERS = {
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: 'SOCS=CAI; CONSENT=YES+cb.20220419-08-p0.cs+FX+411',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const isGoogle = (u) => String(u || '').includes('news.google.com');
// 구 디코더가 남긴 잘린 URL 판별 — 쿼리스트링이 있는데 `=`가 하나도 없는 형태
// (`view.php?no`, `articleView.html?idxno`). 정상 URL에서는 사실상 나오지 않는다.
// ⚠ `?` 자체가 없는 URL(대부분의 매체)은 대상 아님 — 멀쩡한 아이템을 재디코드하면 구글 쿼터만 태운다.
const isTruncatedUrl = (u) => {
    const q = String(u || '').split('?')[1];
    return q !== undefined && q.length > 0 && !q.includes('=');
};

// 구글 뉴스 링크 → 원문 URL (서버 lib/newsFetch.js decodeGoogleUrl과 동일 기법)
async function decodeGoogleUrl(gUrl, circuit) {
    try {
        const m = gUrl.match(/articles\/([^?]+)/);
        if (!m) return null;
        const id = m[1];
        const pageRes = await fetch(`https://news.google.com/articles/${id}`, {
            headers: HEADERS, signal: AbortSignal.timeout(8000),
        });
        if (!pageRes.ok) {
            if (pageRes.status === 429) circuit.blocked = true;
            console.warn('  decode: page', pageRes.status);
            return null;
        }
        const page = await pageRes.text();
        const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
        const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
        if (!sg || !ts) { console.warn('  decode: no sg/ts'); return null; }
        const inner = JSON.stringify(['garturlreq',
            [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
                'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
        const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
        const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
            method: 'POST',
            headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body, signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
            if (res.status === 429) circuit.blocked = true;
            console.warn('  decode: batch', res.status);
            return null;
        }
        const text = await res.text();
        return extractGarturl(text);
    } catch (e) { console.warn('  decode: err', e.message); return null; }
}

// ── batchexecute 응답 → 원문 URL 추출 (2026-07-29 수리) ─────────────────────
// 🚨 구 코드 `(https?:[^\\"]+)`는 백슬래시에서 끊기는데 응답의 `=`는 `\\u003d`(백슬래시 2개)로
//    와서 쿼리스트링 URL이 전부 첫 `=`에서 잘렸다(실측 480건 중 20건). 잘린 URL은 원문 링크가
//    깨질 뿐 아니라 og:image 스크레이프를 실패시켜 저화질 구글 썸네일 폴백을 유발했다.
// ⚠ lib/newsFetch.js에 **동일 사본** — 한쪽만 고치지 말 것(이 워커는 무의존 단독 실행이라 공유 불가).
// 이스케이프 해제 순서 주의: 이중(`\\`) → 단일로 먼저 접고 나서 `\uXXXX`를 푼다.
function extractGarturl(text) {
    const um = text.match(/garturlres\\",\\"(https?:.+?)\\"/) || text.match(/"garturlres","(https?:[^"]+)"/);
    if (!um) { console.warn('  decode: no garturlres'); return null; }
    const url = um[1]
        .replace(/\\\\/g, '\\')
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\\//g, '/');
    if (!/^https?:\/\/[^\s"\\<>]+$/.test(url)) { console.warn('  decode: unescape residue'); return null; }
    return url;
}

// og:image 속성값의 HTML 엔티티 복원 — &amp;·&#x3D; 등이 남으면 쿼리스트링이 깨져
// CDN이 400/404를 반환(2026-07-24 실측: naver scs-phinf `type&#x3D;w800`, elcomercio.pe
// resizer `&amp;width=`). 저장 전 반드시 통과시킬 것.
const decodeEntities = (s) => String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');

async function scrapeOgImage(url) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) return null;
        const html = (await res.text()).slice(0, 200000);
        const og = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
        return og && og[1].startsWith('http') ? decodeEntities(og[1]) : null;
    } catch { return null; }
}

// ── 구글 뉴스 '웹 검색' 페이지 → 기사ID→썸네일 벌크 맵 (2026-07-24) ─────────────
// 원문이 봇월(WP Engine 등 TLS 지문 403)이라 og:image를 못 긁는 소스가 존재
// (실측: fr 피드 67%를 차지한 altselection.ouest-france.fr 전면 403). 같은 검색
// 쿼리의 웹 페이지(rss/search→search)는 서버렌더 HTML에 기사별 썸네일이 실려 있고,
//   · read/<id>의 id = RSS articles/<id>의 id (동일 문자열 — ko 캐시 40건 중 37건 조인 실측)
//   · /api/attachments/<att>-w400-h224…는 무인증 302 → 공개 gstatic 이미지(핫링크 가능)
// 라 스크레이프 불가 기사도 커버된다. 언어당 최대 1 fetch — 디코드와 동일 예산 계상.
// ⚠ 쿼리는 서버 lib/newsFetch.js LANG_FEEDS와 수동 동기(피드 쿼리 변경 시 여기도).
const SEARCH_PAGES = {
    ko: 'https://news.google.com/search?q=%ED%95%9C%EA%B5%AD+%EB%93%9C%EB%9D%BC%EB%A7%88&hl=ko&gl=KR&ceid=KR:ko',
    en: 'https://news.google.com/search?q=kdrama&hl=en-US&gl=US&ceid=US:en',
    ja: 'https://news.google.com/search?q=%E9%9F%93%E5%9B%BD%E3%83%89%E3%83%A9%E3%83%9E&hl=ja&gl=JP&ceid=JP:ja',
    'zh-CN': 'https://news.google.com/search?q=%E9%9F%A9%E5%89%A7&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
    vi: 'https://news.google.com/search?q=phim+H%C3%A0n+Qu%E1%BB%91c&hl=vi&gl=VN&ceid=VN:vi',
    fr: 'https://news.google.com/search?q=drama+cor%C3%A9en&hl=fr&gl=FR&ceid=FR:fr',
    de: 'https://news.google.com/search?q=k-drama&hl=de&gl=DE&ceid=DE:de',
    es: 'https://news.google.com/search?q=dorama+coreano&hl=es-419&gl=MX&ceid=MX:es-419',
    ru: 'https://news.google.com/search?q=%D0%B4%D0%BE%D1%80%D0%B0%D0%BC%D0%B0&hl=ru&gl=RU&ceid=RU:ru',
    'pt-BR': 'https://news.google.com/search?q=dorama+coreano&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    id: 'https://news.google.com/search?q=drakor&hl=id&gl=ID&ceid=ID:id',
    ar: 'https://news.google.com/search?q=%D9%85%D8%B3%D9%84%D8%B3%D9%84+%D9%83%D9%88%D8%B1%D9%8A&hl=ar&gl=SA&ceid=SA:ar',
};
async function fetchThumbMap(lang, circuit) {
    const pageUrl = SEARCH_PAGES[lang];
    if (!pageUrl) return null;
    try {
        const res = await fetch(pageUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
            if (res.status === 429) circuit.blocked = true;
            console.warn(`  thumbMap: HTTP ${res.status}`);
            return null;
        }
        const html = await res.text();
        // 기사 블록당 read/<id> 뒤 ~525자 지점에 썸네일이 옴(블록 간격 ~24KB라 1500자 창이면 안전)
        const imgs = [...html.matchAll(/\/api\/attachments\/([A-Za-z0-9_=-]+)-w400-h224/g)];
        const map = new Map();
        for (const m of html.matchAll(/read\/([A-Za-z0-9_-]{40,})/g)) {
            if (map.has(m[1])) continue;
            const near = imgs.find((im) => im.index > m.index && im.index - m.index < 1500);
            if (near) map.set(m[1], `https://news.google.com/api/attachments/${near[1]}-w400-h224-p-df-rw`);
        }
        console.log(`  thumbMap: ${map.size} thumbs`);
        return map;
    } catch (e) { console.warn('  thumbMap: err', e.message); return null; }
}

// attachment URL → 302 Location(공개 gstatic 직링크) 해석. 클라 <img>가 news.google.com을
// 직접 치면 쿠키/동의/트래커 차단 등 브라우저 변수로 로드가 깨질 수 있어(2026-07-24 실측:
// 데이터는 정상인데 앱에서 아이콘 폴백으로 강등) 워커가 미리 풀어 최종 이미지 URL만 저장.
const isAttachUrl = (u) => String(u || '').startsWith('https://news.google.com/api/attachments/');
async function resolveThumb(attUrl, circuit) {
    try {
        const res = await fetch(attUrl, { headers: HEADERS, redirect: 'manual', signal: AbortSignal.timeout(8000) });
        if (res.status === 429) circuit.blocked = true;
        const loc = res.headers.get('location');
        return loc && loc.startsWith('http') ? loc : null;
    } catch { return null; }
}

// og:image가 매체 로고/프로필 파일인 소스(예: edaily profile_edaily_512.png)는 기사 사진이
// 아니므로 미스로 취급 → 구글 썸네일 폴백이 실사진을 채우게 한다.
const isLogoImage = (u) => /logo|profile|favicon|default[_.-]/i.test(String(u || ''));

// ── 저장 전 이미지 실기기 검증 (2026-07-24) ─────────────────────────────────────
// 퍼블리셔 CDN 핫링크 정책은 제각각이라 서버(curl류 UA)에서 200이어도 실제 앱 <img>
// (브라우저 UA + no-referrer)에선 403이 나는 소스가 존재(실측: kinoafisha.info — 브라우저
// UA + 무referer 403, curl UA 200). 앱과 동일 조건으로 GET해 통과한 것만 저장하고
// 실패분은 구글 썸네일(gstatic — 핫링크 변수 없음)로 교체. 통과 아이템은 imgV 마커로
// 재검증 생략(서버 enrich 라우트가 imgV를 캐시에 병합).
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const isGoogleCdn = (u) => /^https:\/\/(encrypted-tbn\d\.gstatic\.com|lh\d\.googleusercontent\.com)\//.test(String(u || ''));
async function imageLoadable(url) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': BROWSER_UA, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
            signal: AbortSignal.timeout(6000),
        });
        try { await res.body?.cancel(); } catch { /* 본문 불필요 — 상태·타입만 */ }
        return res.ok && /^image\//i.test(res.headers.get('content-type') || '');
    } catch { return false; }
}

(async () => {
    if (!SECRET) { console.error('NEWS_CRON_SECRET(=서버 CRON_SECRET) 필요'); process.exit(1); }
    const circuit = { blocked: false }; // 전 언어 공유 — 429 시 디코드 중단(스크레이프는 계속)
    let totalPatched = 0;
    let globalDecodes = 0;

    // 언어 시작 순서 회전 — 중간에 429로 끊겨도 매 실행 다른 언어가 앞 순서를 받아
    // 꼬리 언어(ru/pt-BR)가 굶지 않게 함. 2시간 주기 기준 회전.
    const rot = Math.floor(Date.now() / (2 * 60 * 60 * 1000)) % LANGS.length;
    const ordered = [...LANGS.slice(rot), ...LANGS.slice(0, rot)];
    console.log('[worker] lang order:', ordered.join(','));

    for (let li = 0; li < ordered.length; li += 1) {
        const lang = ordered[li];
        let items;
        try {
            // all=1 — GET의 무이미지 제외 필터 우회(워커는 보강 대상을 전부 봐야 함)
            const r = await fetch(`${API}/api/news?lang=${encodeURIComponent(lang)}&limit=40&all=1`, { signal: AbortSignal.timeout(30000) });
            items = (await r.json()).items || [];
        } catch (e) { console.warn(`[${lang}] api read fail:`, e.message); continue; }

        // 공정 분배: 남은 예산 ÷ 남은 언어(올림) — 선착순이면 회전 선두 2~3개 언어의 백로그가
        // 예산 30을 통째로 먹어 뒤 언어(예: ko)가 10시간+ 굶는 실측 문제(2026-07-07).
        // 언어당 ~3건이면 신규 기사(2h당 1~3건)는 매 런 전 언어 처리되고, 밀린 백로그는
        // 앞 언어가 덜 쓴 잔여 예산 + 회전으로 점진 소화된다.
        const langCap = Math.min(DECODE_PER_LANG,
            Math.ceil((GLOBAL_DECODE_BUDGET - globalDecodes) / (ordered.length - li)));

        // 썸네일 맵은 필요해진 순간 언어당 1회만 fetch(lazy) — 전 아이템이 이미 완성이면 0회
        let thumbMap;
        const ensureThumbMap = async () => {
            if (thumbMap !== undefined) return thumbMap;
            if (circuit.blocked || globalDecodes >= GLOBAL_DECODE_BUDGET) return (thumbMap = null);
            globalDecodes += 1; // news.google.com 요청 1회 — 디코드와 동일 예산 계상
            thumbMap = await fetchThumbMap(lang, circuit);
            await sleep(GAP_MS);
            return thumbMap;
        };

        // 사이트 기본 OGP 이미지 감지(2026-07-24): 서로 다른 기사 2개 이상이 같은 이미지를
        // 쓰면 기사 사진이 아니라 사이트 공용 이미지(실측: ja KOARI shop500-28.png — 파일명
        // 휴리스틱·로드 검증 모두 통과). 파일명 무관·내용 무관의 범용 판별이라 신규 매체도 자동.
        const imgFreq = {};
        items.forEach((o) => { if (o.image) imgFreq[o.image] = (imgFreq[o.image] || 0) + 1; });
        // isOwn: u가 해당 아이템 자신의 저장 이미지면 자기 1회를 제외하고 판별
        const isDupImage = (u, isOwn) => (imgFreq[u] || 0) >= (isOwn ? 2 : 1);

        const patches = [];
        let decodes = 0;
        // 잘린 URL 복구는 신규 기사 디코드와 같은 구글 쿼터를 쓴다 → 언어당 런 상한을 둬서
        // 백로그(실측 20건/12언어)가 신규 기사 처리를 굶기지 않게 한다. 2h 주기면 며칠 안에 소진되고,
        // 복구가 계속 실패하는 아이템이 있어도 런당 낭비가 이 상한으로 묶인다.
        const REPAIR_CAP = 3;
        let repairs = 0;
        for (const it of items) {
            const key = it.srcUrl || it.url;
            let url = it.url;
            let patch = null;
            // 구 디코더 버그(위 extractGarturl 주석)로 쿼리스트링이 잘린 채 굳은 아이템은 이미
            // non-google URL이라 아래 "완성" 분기에서 영구 skip된다 → 여기서 재디코드로 복구.
            // 복구 대상은 srcUrl(구글 RSS 링크, 불변 키)로 다시 푼다.
            const repair = !isGoogle(url) && isTruncatedUrl(url) && isGoogle(it.srcUrl) && repairs < REPAIR_CAP;
            let redecoded = false;
            if (isGoogle(url) || repair) {
                // 디코드는 구글 쿼터 소비 — 서킷/언어당(공정 분배)/전역 예산 안에서만. 초과 시 이
                // 아이템만 skip(뒤의 직접 URL 아이템 og:image 스크레이프는 구글 무관이라 계속).
                if (circuit.blocked || decodes >= langCap || globalDecodes >= GLOBAL_DECODE_BUDGET) continue;
                decodes += 1; globalDecodes += 1;
                if (repair) repairs += 1;
                const real = await decodeGoogleUrl(repair ? it.srcUrl : url, circuit);
                await sleep(GAP_MS);
                if (!real) continue;
                if (repair) {
                    // 디코드 결과가 저장값과 같으면 잘린 게 아니라 원래 그런 URL(`?amp` 등 드묾).
                    // 이미지 재처리 없이 통과 — 매 런 og 재스크레이프를 도는 것을 막는다.
                    if (real === it.url) continue;
                    console.log(`  [${lang}] repaired truncated url: ${url} → ${real}`);
                    redecoded = true; // 저장된 구글 썸네일 대신 원문 og:image를 다시 긁게 한다
                }
                url = real;
                patch = { srcUrl: key, url: real, id: sha1(real) };
                try { patch.icon = `https://www.google.com/s2/favicons?domain=${new URL(real).hostname}&sz=64`; } catch { /* 유지 */ }
            } else if (isAttachUrl(it.image)) {
                // 과거 런이 news.google.com attachment URL을 저장한 아이템 — gstatic 직링크로
                // 1회성 마이그레이션(브라우저에서 attachment 핫링크가 깨지는 문제).
                const direct = await resolveThumb(it.image, circuit);
                await sleep(150);
                if (direct) patches.push({ srcUrl: key, image: direct });
                continue;
            } else if (it.image && (it.imgV || isGoogleCdn(it.image))
                && !isLogoImage(it.image) && !isDupImage(it.image, true)
                && !/&#|&amp;/.test(it.image) && !it.image.startsWith('http://')) {
                continue; // 검증 통과(imgV) 또는 구글 CDN — 완성 아이템 (http://·중복 저장분은 재처리)
            }
            // 여기 도달: 이미지 없음 / 미검증·로고·엔티티·http·중복 저장분 / 방금 디코드된 신규
            const cleanStored = it.image && !isLogoImage(it.image) && !isDupImage(it.image, true) && !/&#|&amp;/.test(it.image);
            // redecoded(잘린 URL 복구분)는 저장 이미지가 **그 버그 때문에** 강등된 구글 썸네일이므로
            // 신뢰하지 않고 원문에서 다시 긁는다. 실패하면 아래 폴백이 다시 구글 썸네일로 되돌린다.
            let img = (cleanStored && !redecoded) ? it.image : await scrapeOgImage(url);
            // https 앱에서 http:// 이미지는 mixed content로 브라우저가 무조건 차단(실측: sinaimg —
            // imgV 검증은 프로토콜 무관이라 통과해버림) → https 승격 후 아래 검증으로 확인,
            // 승격이 안 먹는 CDN이면 검증 실패 → 구글 썸네일 교체.
            if (img && img.startsWith('http://')) img = `https://${img.slice(7)}`;
            if (img && !isGoogleCdn(img) && !(await imageLoadable(img))) {
                console.log(`  [${lang}] img unloadable on device: ${String(img).slice(0, 70)}`);
                img = null; // 실기기에서 깨지는 URL — 구글 썸네일 교체 대상
            }
            if (!img || isLogoImage(img) || isDupImage(img, img === it.image)) {
                // 원문 스크레이프 실패(봇월 403·og:image 부재)·기기 로드 불가·로고/사이트 공용 이미지
                // → 구글 썸네일 폴백 (그마저 없으면 로고라도 유지 — 없는 것보단 나음)
                const gid = String(it.srcUrl || '').match(/articles\/([A-Za-z0-9_-]+)/)?.[1];
                const att = gid && (await ensureThumbMap())?.get(gid);
                if (att) {
                    const direct = await resolveThumb(att, circuit);
                    await sleep(150);
                    if (direct) img = direct;
                }
            }
            if (img) {
                patch = { ...(patch || { srcUrl: key }), imgV: 1 };
                if (img !== it.image) patch.image = img;
            }
            if (patch) patches.push(patch);
        }

        if (patches.length) {
            try {
                const r = await fetch(`${API}/api/news/enrich`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-cron-secret': SECRET },
                    body: JSON.stringify({ lang, patches }),
                    signal: AbortSignal.timeout(30000),
                });
                const j = await r.json();
                console.log(`[${lang}] patches ${patches.length} → applied ${j.applied ?? '?'} (HTTP ${r.status})`);
                totalPatched += j.applied || 0;
            } catch (e) { console.warn(`[${lang}] enrich POST fail:`, e.message); }
        } else {
            console.log(`[${lang}] nothing to patch${circuit.blocked ? ' (429)' : ''}`);
        }
    }
    console.log('[worker] done — applied', totalPatched, '| decodes', globalDecodes + '/' + GLOBAL_DECODE_BUDGET, circuit.blocked ? '| 429 circuit opened' : '');
})();
