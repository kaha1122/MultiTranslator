/**
 * PronunFit 스토어 프로모 — 포스터형 풀 리디자인 생성기 (Claude 디자인 / HTML+Puppeteer)
 * ────────────────────────────────────────────────────────────────────────────
 * 원칙:
 *  - 큰 헤드라인만(서브카피·체크리스트 제거)
 *  - 큰 폰 목업 (이미지 임베드 X → HTML/CSS로 현지화 가능한 앱 화면 직접 렌더)
 *  - 고채도 민트 브랜드 (저채도 파스텔 폐기)
 *  - 이모지 미사용 → 인라인 SVG 아이콘 (Linux 이모지 폰트 부재 대응)
 *  - P1 = 폰 없는 히어로 커버
 *
 * 사용: node generate_poster.mjs --lang ko
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
  return a;
}, []));
const LANG = args.lang || 'ko';

const logoB64 = fs.existsSync(path.join(__dirname, 'logo.png'))
  ? 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'logo.png')).toString('base64')
  : '';

/* ── SVG 아이콘 (currentColor) ── */
const I = {
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  plane: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 15.5l-7-2V7.8c0-.9-.6-1.8-1.5-1.8S11 6.9 11 7.8v5.7l-7 2v1.7l7-1.5v3.3l-1.8 1.2v1.3L12 21l2.8.5v-1.3L13 19v-3.3l7 1.5z"/></svg>`,
  briefcase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z"/><path d="M19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>`,
};

/* ── 진행 링 (conic-gradient) ── */
const ring = (val, label, color = '#00a884') => `
  <div class="ring">
    <div class="ring-c" style="background:conic-gradient(${color} ${val * 3.6}deg, #e6f4f0 0deg)">
      <div class="ring-in"><b>${val}</b></div>
    </div>
    <span>${label}</span>
  </div>`;

/* ── 폰 목업 안에 들어가는 앱 화면들 (현지화 텍스트는 t에서) ── */
function screen(kind, t) {
  if (kind === 'topic') return `
    <div class="appbar"><img src="${logoB64}" class="ab-logo"/><span>PronunFit</span>
      <div class="levels"><i>${t.lv1}</i><i class="on">${t.lv2}</i><i>${t.lv3}</i></div></div>
    <div class="app-body">
      <div class="sec-label">${t.topicLabel}</div>
      ${[['plane', t.tp1], ['briefcase', t.tp2], ['chat', t.tp3]].map((c, i) => `
        <div class="topic-card${i === 0 ? ' sel' : ''}"><span class="tc-ic">${I[c[0]]}</span>
          <div class="tc-txt"><b>${c[1]}</b></div>${i === 0 ? `<span class="tc-chk">${I.check}</span>` : ''}</div>`).join('')}
      <div class="gen-btn"><span>${I.sparkle}</span>${t.genBtn}</div>
    </div>`;

  if (kind === 'multi') return `
    <div class="appbar"><img src="${logoB64}" class="ab-logo"/><span>PronunFit</span>
      <div class="pill">${t.simulBadge}</div></div>
    <div class="app-body">
      <div class="sec-label">${t.multiLabel}</div>
      ${[['EN', '#2563eb', 'Where is the gate?'], ['JA', '#dc2626', 'ゲートはどこですか'], ['ZH', '#d97706', '登机口在哪里']].map(r => `
        <div class="lang-row"><span class="lang-chip" style="background:${r[1]}">${r[0]}</span>
          <div class="lang-txt">${r[2]}<span class="play">${I.mic}</span></div></div>`).join('')}
      <div class="hint">${t.multiHint}</div>
    </div>`;

  if (kind === 'score') return `
    <div class="appbar"><img src="${logoB64}" class="ab-logo"/><span>PronunFit</span>
      <div class="pill ok">${t.scoreBadge}</div></div>
    <div class="app-body center">
      <div class="rings">${ring(92, t.acc)}${ring(88, t.flu)}${ring(95, t.pro)}</div>
      <div class="wave">${Array.from({ length: 22 }).map((_, i) => `<span style="height:${20 + Math.abs(Math.sin(i * 0.9)) * 70}%"></span>`).join('')}</div>
      <div class="listen-btn"><span>${I.mic}</span>${t.listen}</div>
      <div class="ai-fb"><b>AI</b> ${t.aiFb}</div>
    </div>`;

  if (kind === 'price') return `
    <div class="appbar"><img src="${logoB64}" class="ab-logo"/><span>PronunFit</span>
      <div class="pill">PRO</div></div>
    <div class="app-body center">
      <div class="price-card">
        <div class="pc-old">${t.compPrice}</div>
        <div class="pc-now"><b>${t.proPrice}</b><span>${t.perMonth}</span></div>
        <div class="pc-tags">${[t.tag1, t.tag2, t.tag3].map(x => `<i><span>${I.check}</span>${x}</i>`).join('')}</div>
      </div>
      <div class="gen-btn wide"><span>${I.bolt}</span>${t.startBtn}</div>
    </div>`;
  return '';
}

/* ── 패널 HTML ── */
function panelHTML(p) {
  const head = p.head.split('\n').map(l =>
    p.hl && l.includes(p.hl) ? l.replace(p.hl, `<span class="hl">${p.hl}</span>`) : l).join('<br>');

  if (p.layout === 'cover') return `
    <div class="cover">
      <div class="logo-badge"><img src="${logoB64}"/></div>
      <div class="wordmark">PronunFit</div>
      <h1 class="cover-h">${head}</h1>
      <div class="trust">${p.trust.map(x => `<span>${x}</span>`).join('<i></i>')}</div>
    </div>`;

  return `
    <div class="panel">
      <div class="top">
        ${p.kicker ? `<div class="kicker"><span>${I[p.kIcon] || ''}</span>${p.kicker}</div>` : ''}
        <h1>${head}</h1>
      </div>
      <div class="phone-stage">
        <div class="phone">
          <div class="notch"></div>
          <div class="screen">${screen(p.screen, p.t)}</div>
        </div>
        <div class="glow"></div>
      </div>
    </div>`;
}

/* ── 전체 문서 CSS ── */
function doc(inner) {
  return `<!DOCTYPE html><html lang="${LANG}"><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased}
  html,body{width:1080px;height:1920px}
  body{font-family:'Noto Sans CJK KR','Noto Sans KR',sans-serif;color:#0b3b34;
    position:relative;overflow:hidden}
  .bg{position:absolute;inset:0;background:
    radial-gradient(120% 80% at 80% -10%, #18d2af 0%, transparent 55%),
    radial-gradient(120% 90% at -10% 110%, #0a7a66 0%, transparent 60%),
    linear-gradient(160deg,#00c79e 0%,#00a884 42%,#0c8470 100%)}
  .bg::after{content:'';position:absolute;inset:0;
    background-image:radial-gradient(rgba(255,255,255,.05) 1.4px,transparent 1.4px);
    background-size:34px 34px;opacity:.6}
  .orb{position:absolute;border-radius:50%;filter:blur(2px)}
  .orb.a{width:520px;height:520px;top:-160px;right:-120px;background:radial-gradient(circle,rgba(255,255,255,.16),transparent 65%)}
  .orb.b{width:420px;height:420px;bottom:-120px;left:-140px;background:radial-gradient(circle,rgba(255,255,255,.10),transparent 65%)}

  /* 헤드라인 */
  .top{position:relative;z-index:3;padding:120px 92px 0}
  .kicker{display:inline-flex;align-items:center;gap:14px;color:#063a30;
    background:rgba(255,255,255,.92);padding:16px 30px;border-radius:999px;
    font-size:30px;font-weight:800;margin-bottom:34px;box-shadow:0 12px 30px rgba(0,0,0,.12)}
  .kicker span{width:34px;height:34px;display:inline-flex;color:#00a884}
  .kicker span svg{width:100%;height:100%}
  h1{color:#fff;font-weight:900;font-size:108px;line-height:1.12;
    letter-spacing:-2px;text-shadow:0 6px 24px rgba(0,40,33,.28)}
  .hl{color:#ffe14d}

  /* 폰 */
  .phone-stage{position:absolute;left:0;right:0;bottom:-40px;display:flex;justify-content:center;z-index:2}
  .glow{position:absolute;bottom:120px;width:680px;height:680px;border-radius:50%;
    background:radial-gradient(circle,rgba(255,255,255,.22),transparent 60%);z-index:-1}
  .phone{width:660px;height:1180px;background:#0b1220;border-radius:74px;
    padding:20px;box-shadow:0 50px 90px rgba(0,30,24,.40),0 0 0 2px rgba(255,255,255,.10);
    position:relative}
  .notch{position:absolute;top:34px;left:50%;transform:translateX(-50%);
    width:200px;height:34px;background:#0b1220;border-radius:0 0 22px 22px;z-index:5}
  .screen{width:100%;height:100%;background:#f4faf8;border-radius:56px;overflow:hidden;
    display:flex;flex-direction:column}

  /* 앱바 */
  .appbar{display:flex;align-items:center;gap:16px;padding:62px 40px 26px;
    background:linear-gradient(180deg,#00b894,#00a884);color:#fff;font-size:36px;font-weight:800}
  .ab-logo{width:54px;height:54px;border-radius:14px;background:#fff;padding:4px}
  .levels{margin-left:auto;display:flex;gap:8px}
  .levels i{font-style:normal;font-size:25px;font-weight:700;color:#d6fff3;
    background:rgba(255,255,255,.18);padding:8px 18px;border-radius:999px}
  .levels i.on{background:#fff;color:#00a884}
  .pill{margin-left:auto;font-size:26px;font-weight:800;background:rgba(255,255,255,.2);
    color:#fff;padding:9px 22px;border-radius:999px}
  .pill.ok{background:#fff;color:#00a884}

  .app-body{flex:1;padding:40px 40px;display:flex;flex-direction:column;gap:26px}
  .app-body.center{justify-content:flex-start;gap:34px;padding-top:54px}
  .sec-label{font-size:34px;font-weight:800;color:#0b3b34}

  /* 주제 카드 */
  .topic-card{display:flex;align-items:center;gap:24px;background:#fff;border-radius:30px;
    padding:34px 32px;box-shadow:0 10px 26px rgba(0,60,48,.08);border:3px solid transparent}
  .topic-card.sel{border-color:#00a884;background:#effaf6}
  .tc-ic{width:64px;height:64px;border-radius:18px;background:#e2f6ef;color:#00a884;
    display:flex;align-items:center;justify-content:center}
  .tc-ic svg{width:36px;height:36px}
  .tc-txt b{font-size:37px;font-weight:800;color:#0b3b34}
  .tc-chk{margin-left:auto;width:46px;height:46px;border-radius:50%;background:#00a884;color:#fff;
    display:flex;align-items:center;justify-content:center}
  .tc-chk svg{width:28px;height:28px}
  .gen-btn{margin-top:8px;display:flex;align-items:center;justify-content:center;gap:18px;
    background:linear-gradient(135deg,#00c79e,#00a884);color:#fff;font-size:38px;font-weight:800;
    padding:34px;border-radius:28px;box-shadow:0 16px 34px rgba(0,168,132,.40)}
  .gen-btn.wide{margin-top:20px}
  .gen-btn span{width:42px;height:42px;display:inline-flex}
  .gen-btn svg{width:100%;height:100%}

  /* 다국어 */
  .lang-row{display:flex;align-items:center;gap:22px}
  .lang-chip{color:#fff;font-size:30px;font-weight:900;width:84px;height:84px;border-radius:22px;
    display:flex;align-items:center;justify-content:center;flex:none}
  .lang-txt{flex:1;background:#fff;border-radius:24px;padding:30px 30px;font-size:38px;font-weight:700;
    color:#0b3b34;display:flex;align-items:center;box-shadow:0 10px 24px rgba(0,60,48,.08)}
  .play{margin-left:auto;width:46px;height:46px;color:#00a884;display:inline-flex}
  .play svg{width:100%;height:100%}
  .hint{margin-top:6px;text-align:center;font-size:30px;font-weight:700;color:#3c7a6c}

  /* 점수 */
  .rings{display:flex;justify-content:space-between;gap:18px}
  .ring{flex:1;display:flex;flex-direction:column;align-items:center;gap:18px}
  .ring-c{width:168px;height:168px;border-radius:50%;display:flex;align-items:center;justify-content:center}
  .ring-in{width:128px;height:128px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;
    box-shadow:inset 0 2px 8px rgba(0,60,48,.06)}
  .ring-in b{font-size:58px;font-weight:900;color:#00a884}
  .ring span{font-size:30px;font-weight:800;color:#0b3b34}
  .wave{display:flex;align-items:center;gap:9px;height:120px;background:#fff;border-radius:26px;
    padding:0 30px;justify-content:center;box-shadow:0 10px 24px rgba(0,60,48,.08)}
  .wave span{flex:1;max-width:14px;background:linear-gradient(180deg,#00c79e,#00a884);border-radius:8px}
  .listen-btn{display:flex;align-items:center;justify-content:center;gap:16px;background:#effaf6;
    border:3px solid #00a884;color:#00a884;font-size:36px;font-weight:800;padding:28px;border-radius:26px}
  .listen-btn span{width:40px;height:40px;display:inline-flex}
  .listen-btn svg{width:100%;height:100%}
  .ai-fb{background:#fff;border-radius:24px;padding:30px;font-size:33px;font-weight:600;color:#0b3b34;
    line-height:1.4;box-shadow:0 10px 24px rgba(0,60,48,.08)}
  .ai-fb b{background:#00a884;color:#fff;font-size:26px;padding:4px 16px;border-radius:10px;margin-right:14px}

  /* 가격 */
  .price-card{background:#fff;border-radius:34px;padding:50px 44px;text-align:center;
    box-shadow:0 18px 40px rgba(0,60,48,.12)}
  .pc-old{font-size:36px;color:#9aa9a4;text-decoration:line-through;font-weight:700}
  .pc-now{display:flex;align-items:baseline;justify-content:center;gap:14px;margin:10px 0 30px}
  .pc-now b{font-size:104px;font-weight:900;color:#00a884;letter-spacing:-2px}
  .pc-now span{font-size:38px;font-weight:800;color:#3c7a6c}
  .pc-tags{display:flex;flex-direction:column;gap:18px;text-align:left}
  .pc-tags i{font-style:normal;display:flex;align-items:center;gap:18px;font-size:34px;font-weight:700;color:#0b3b34}
  .pc-tags i span{width:40px;height:40px;border-radius:50%;background:#e2f6ef;color:#00a884;
    display:inline-flex;align-items:center;justify-content:center;flex:none}
  .pc-tags i span svg{width:24px;height:24px}

  /* 커버 */
  .cover{position:relative;z-index:3;height:100%;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;padding:0 90px}
  .logo-badge{width:230px;height:230px;border-radius:60px;background:#fff;padding:30px;
    box-shadow:0 30px 70px rgba(0,30,24,.30);margin-bottom:48px}
  .logo-badge img{width:100%;height:100%}
  .wordmark{color:#fff;font-size:52px;font-weight:900;letter-spacing:1px;margin-bottom:40px;opacity:.96}
  .cover-h{color:#fff;font-size:128px;font-weight:900;line-height:1.1;letter-spacing:-3px;
    text-shadow:0 8px 30px rgba(0,40,33,.3)}
  .cover .hl{color:#ffe14d}
  .trust{margin-top:60px;display:flex;align-items:center;gap:26px;color:#fff;font-size:32px;font-weight:800}
  .trust i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.6)}
  .trust span{opacity:.97}
  </style></head><body>
    <div class="bg"></div><div class="orb a"></div><div class="orb b"></div>
    ${inner}
  </body></html>`;
}

/* ── 한국어 콘텐츠 ── */
const T_KO = {
  lv1: '쉬움', lv2: '보통', lv3: '고급',
  topicLabel: '오늘의 주제 선택', tp1: '여행 · 공항', tp2: '비즈니스 미팅', tp3: '일상 대화',
  genBtn: '새 지문 생성',
  simulBadge: '동시 학습', multiLabel: '한 문장, 세 가지 언어', multiHint: '한 번에 3개 국어를 함께',
  scoreBadge: '평가 완료', acc: '정확도', flu: '유창성', pro: '운율',
  listen: '내 발음 듣기', aiFb: "'r' 발음을 조금만 더 굴려보세요.",
  compPrice: '타 앱 월 ₩15,000', proPrice: '₩2,500', perMonth: '/ 월',
  tag1: '무제한 발음 평가', tag2: '무제한 학습 카드', tag3: '38개 언어 전체',
  startBtn: '지금 시작하기',
};

const PANELS_KO = [
  { layout: 'cover', head: '발음부터 회화까지\nAI 하나로', hl: 'AI 하나로',
    trust: ['38개 언어', 'AI 발음 분석', '다국어 동시'] },
  { layout: 'phone', screen: 'topic', t: T_KO, kicker: '자기주도 학습', kIcon: 'sparkle',
    head: '내가 설계하는\n언어 학습', hl: '내가 설계' },
  { layout: 'phone', screen: 'multi', t: T_KO, kicker: '다국어 동시 학습', kIcon: 'globe',
    head: '하나를 배우면\n셋을 얻는다', hl: '셋을 얻는다' },
  { layout: 'phone', screen: 'score', t: T_KO, kicker: '초정밀 발음 교정', kIcon: 'mic',
    head: '음소 단위까지\n발음 교정', hl: '음소 단위' },
  { layout: 'phone', screen: 'price', t: T_KO, kicker: '압도적 가성비', kIcon: 'bolt',
    head: '타 앱 한 달 값으로\n여섯 달의 실력', hl: '여섯 달' },
];

const SETS = { ko: PANELS_KO };

/* ── 렌더 ── */
(async () => {
  const panels = SETS[LANG];
  const outDir = path.join(__dirname, `poster_${LANG}`);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  for (let i = 0; i < panels.length; i++) {
    await page.setContent(doc(panelHTML(panels[i])), { waitUntil: 'networkidle0' });
    const file = path.join(outDir, `poster_${String(i + 1).padStart(2, '0')}_${LANG}.png`);
    await page.screenshot({ path: file });
    console.log('✅', file);
  }
  await browser.close();
})();
