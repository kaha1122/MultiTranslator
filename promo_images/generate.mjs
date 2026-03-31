/**
 * PronunFit 플레이스토어 홍보 이미지 생성기 (HTML + Puppeteer)
 * ─────────────────────────────────────────────────────────────
 *
 * 사용법:
 *   node generate.mjs --config 1 --screenshot app_screenshot.png
 *   node generate.mjs --screenshot img.png --title "타이틀" --subtitle "서브" --output out.png
 *
 * 옵션:
 *   --config N       프리셋 1~5
 *   --screenshot     폰 안에 넣을 스크린샷 경로
 *   --title          메인 카피 (\n으로 줄바꿈)
 *   --highlight      강조 단어
 *   --subtitle       서브 카피
 *   --badges         하단 뱃지 (쉼표 구분)
 *   --output         출력 파일명
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 프리셋 ──
const PRESETS = {
  1: {
    name: '자기 주도성',
    title: '당신이 직접 설계하는\n언어 학습의 혁명',
    highlight: '혁명',
    subtitle: '짜여진 시나리오대로, 알려주는 문장만 학습해서\n언제 언어를 마스터 할 수 있을까요?',
    badges: ['🌐 10개 언어', '📊 3단계 난이도', '📂 70개 주제', '🎯 나만의 목표'],
  },
  2: {
    name: '다국어 동시 학습',
    title: '하나를 배울 때\n셋을 얻는 압도적 효율',
    highlight: '압도적 효율',
    subtitle: '업계 유일의 3개 국어 동시 학습으로\n학습 속도를 3배 높이세요',
    badges: ['🇺🇸 English', '🇯🇵 日本語', '🇨🇳 中文', '🇫🇷 +7 언어'],
  },
  3: {
    name: '초정밀 발음 교정',
    title: '음소 단위까지 쪼개어\n완성하는 완벽 발음',
    highlight: '완벽 발음',
    subtitle: 'AI가 당신의 목소리를 음절 단위로\n분석하여 짚어주는 디테일한 피드백',
    badges: ['🎯 정확도', '🗣 유창성', '🎵 운율감', '🤖 AI 코치'],
  },
  4: {
    name: '무한 생성 커리큘럼',
    title: 'AI가 실시간으로 생성하는\n무한 커리큘럼',
    highlight: '무한 커리큘럼',
    subtitle: '70개 카테고리와 22가지 실전 상황\n끊임없이 업데이트되는 지능형 데이터',
    badges: ['📂 70개 주제', '🎭 22개 상황', '📊 3단계', '♾️ 무한 생성'],
  },
  5: {
    name: '실속형 가성비',
    title: '거품은 빼고 실력만 채운\n압도적 가성비',
    highlight: '압도적 가성비',
    subtitle: '타 앱 1개월 비용으로\n6개월의 가치를 경험하세요',
    badges: ['💰 월 $1.99', '📱 10개 언어', '🎙 무제한 발음', '📚 무제한 카드'],
  },
};

// ── 인자 파싱 ──
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] || '';
      i++;
    }
  }
  return args;
}

// ── HTML 생성 ──
// 테마 컬러 프리셋
const THEMES = {
  green: {
    bg: 'linear-gradient(175deg, #f0fdf4 0%, #dcfce7 28%, #e8f5e9 55%, #f0fdf4 100%)',
    dot: 'rgba(0,168,132,0.04)',
    orb1: 'rgba(0,168,132,0.06)', orb2: 'rgba(16,185,129,0.05)', orb3: 'rgba(52,211,153,0.05)',
    deco: 'rgba(0,168,132,0.09)', deco2: 'rgba(16,185,129,0.1)',
    accent: '#00a884', accentLight: 'rgba(0,168,132,0.13)',
    phoneBorder: '#d1d5db', badgeBorder: '#a7f3d0',
    shadow3d1: '#008f72', shadow3d2: '#007a5e',
    bgEnd: 'rgba(240,253,244',
  },
  blue: {
    bg: 'linear-gradient(175deg, #eff6ff 0%, #dbeafe 28%, #e0f2fe 55%, #eff6ff 100%)',
    dot: 'rgba(59,130,246,0.04)',
    orb1: 'rgba(59,130,246,0.06)', orb2: 'rgba(96,165,250,0.05)', orb3: 'rgba(147,197,253,0.05)',
    deco: 'rgba(59,130,246,0.09)', deco2: 'rgba(96,165,250,0.1)',
    accent: '#2563eb', accentLight: 'rgba(37,99,235,0.13)',
    phoneBorder: '#d1d5db', badgeBorder: '#bfdbfe',
    shadow3d1: '#1d4ed8', shadow3d2: '#1e40af',
    bgEnd: 'rgba(239,246,255',
  },
  gold: {
    bg: 'linear-gradient(175deg, #fffbeb 0%, #fef3c7 28%, #fde68a 55%, #fffbeb 100%)',
    dot: 'rgba(217,119,6,0.04)',
    orb1: 'rgba(217,119,6,0.06)', orb2: 'rgba(245,158,11,0.05)', orb3: 'rgba(252,211,77,0.05)',
    deco: 'rgba(217,119,6,0.09)', deco2: 'rgba(245,158,11,0.1)',
    accent: '#d97706', accentLight: 'rgba(217,119,6,0.13)',
    phoneBorder: '#d1d5db', badgeBorder: '#fde68a',
    shadow3d1: '#b45309', shadow3d2: '#92400e',
    bgEnd: 'rgba(255,251,235',
  },
  peach: {
    bg: 'linear-gradient(175deg, #fff7ed 0%, #ffedd5 28%, #fed7aa 55%, #fff7ed 100%)',
    dot: 'rgba(234,88,12,0.04)',
    orb1: 'rgba(234,88,12,0.06)', orb2: 'rgba(251,146,60,0.05)', orb3: 'rgba(253,186,116,0.05)',
    deco: 'rgba(234,88,12,0.09)', deco2: 'rgba(251,146,60,0.1)',
    accent: '#ea580c', accentLight: 'rgba(234,88,12,0.13)',
    phoneBorder: '#d1d5db', badgeBorder: '#fed7aa',
    shadow3d1: '#c2410c', shadow3d2: '#9a3412',
    bgEnd: 'rgba(255,247,237',
  },
  purple: {
    bg: 'linear-gradient(175deg, #faf5ff 0%, #f3e8ff 28%, #ede9fe 55%, #faf5ff 100%)',
    dot: 'rgba(139,92,246,0.04)',
    orb1: 'rgba(139,92,246,0.06)', orb2: 'rgba(167,139,250,0.05)', orb3: 'rgba(196,181,253,0.05)',
    deco: 'rgba(139,92,246,0.09)', deco2: 'rgba(167,139,250,0.1)',
    accent: '#7c3aed', accentLight: 'rgba(124,58,237,0.13)',
    phoneBorder: '#d1d5db', badgeBorder: '#ddd6fe',
    shadow3d1: '#6d28d9', shadow3d2: '#5b21b6',
    bgEnd: 'rgba(250,245,255',
  },
};

function generateHTML({ title, highlight, subtitle, badges, screenshotDataUri, recommendTitle, recommendItems, theme = 'green', glowPos = '', sideChecklist = [], starPositions = [] }) {
  const T = THEMES[theme] || THEMES.green;
  // 타이틀 처리: highlight 단어를 span으로 감싸기
  const titleLines = title.split('\n').map(line => {
    if (highlight && line.includes(highlight)) {
      return line.replace(highlight, `<span class="hl">${highlight}</span>`);
    }
    return line;
  }).join('<br>');

  const subtitleHTML = subtitle.split('\n').join('<br>');

  const badgesHTML = badges.map(b =>
    `<div class="badge">${b}</div>`
  ).join('');

  // 사이드 체크리스트 (폰 옆에 표시)
  const sideCheckHTML = sideChecklist.length > 0
    ? `<div class="side-checklist">${sideChecklist.map(item =>
        `<div class="side-check-item">
          <span class="side-check-icon">${item.icon}</span>
          <span class="side-check-text">${item.text}</span>
          <span class="side-check-mark">✅</span>
        </div>`).join('')}</div>`
    : '';

  // 폰 위 별표 오버레이 (--stars "0.28,0.36,0.44,0.52,0.60,0.68")
  const starsHTML = starPositions.length > 0
    ? starPositions.map(yRatio =>
        `<div style="position:absolute; top:${yRatio * 100}%; right:12%; z-index:2; font-size:36px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.15));">⭐</div>`
      ).join('')
    : '';

  // 확대경 (glowPos = "0.16" → 스크린샷에서 해당 Y비율 영역을 확대)
  let glowHTML = '';
  if (glowPos) {
    const pos = parseFloat(glowPos);
    // 폰 내부 이미지 크기: 484px wide. 확대 2배 → 968px
    const scale = 2.0;
    const imgW = 484 * scale;
    // Y offset: 스크린샷 비율 → 확대 이미지 기준 offset
    const imgOffsetY = -(pos * imgW * (2340/1080)) + 160; // 원 중심에 맞추기
    const imgOffsetX = -(imgW - 280) / 2; // 수평 중앙
    // 돋보기 안에 보여줄 영역: 언어Pills 근처 (스크린샷의 pos 비율 위치)
    // 폰 width=484, 스크린샷 원본=1080x2340
    // 돋보기 원 안에서 확대된 이미지의 offset 계산
    const magSize = 280; // 돋보기 지름
    const zoomScale = 1.1; // 확대 배율
    const zoomedW = 484 * zoomScale; // 확대된 이미지 width
    const zoomedH = zoomedW * (2340 / 1080); // 확대된 이미지 height (비율 유지)
    // 확대 영역 중심을 돋보기 중심에 맞추기
    const centerX = zoomedW * 0.25; // 스크린샷 좌측 (언어Pills 위치)
    const centerY = zoomedH * pos; // Y비율 기반
    const offsetX = -(centerX - magSize / 2);
    const offsetY = -(centerY - magSize / 2);

    glowHTML = `
      <div class="magnifier" style="position:absolute; top:2%; left:-150px; overflow:hidden;">
        <img src="${screenshotDataUri}" style="width:${zoomedW}px; height:${zoomedH}px; position:absolute; top:${offsetY}px; left:${offsetX}px;" />
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 1080px;
    height: 1920px;
    overflow: hidden;
    font-family: 'Noto Sans KR', sans-serif;
    background: ${T.bg};
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* ── 배경 장식 ── */
  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(${T.dot} 1px, transparent 1px);
    background-size: 28px 28px;
    z-index: 0;
  }
  .bg-orb {
    position: absolute;
    border-radius: 50%;
    z-index: 0;
    pointer-events: none;
  }
  .bg-orb.o1 { width: 420px; height: 420px; top: -80px; right: -80px; background: radial-gradient(circle, ${T.orb1} 0%, transparent 70%); }
  .bg-orb.o2 { width: 350px; height: 350px; bottom: 250px; left: -100px; background: radial-gradient(circle, ${T.orb2} 0%, transparent 70%); }
  .bg-orb.o3 { width: 250px; height: 250px; top: 550px; right: -40px; background: radial-gradient(circle, ${T.orb3} 0%, transparent 70%); }

  .deco {
    position: absolute;
    z-index: 0;
    pointer-events: none;
  }
  .deco.d1 { width: 50px; height: 50px; top: 170px; left: 65px; border: 2px solid ${T.deco}; border-radius: 14px; transform: rotate(20deg); }
  .deco.d2 { width: 32px; height: 32px; top: 310px; right: 85px; border: 2px solid ${T.deco2}; border-radius: 50%; }
  .deco.d3 { width: 9px; height: 9px; top: 250px; left: 190px; background: ${T.deco}; border-radius: 50%; }
  .deco.d4 { width: 6px; height: 6px; top: 360px; right: 170px; background: ${T.deco2}; border-radius: 50%; }
  .deco.d5 { width: 65px; height: 65px; bottom: 280px; right: 100px; border: 2px solid ${T.dot}; border-radius: 18px; transform: rotate(-12deg); }

  /* ── 상단 카피 ── */
  .top-copy {
    position: relative;
    z-index: 1;
    text-align: center;
    padding-top: 90px;
    padding-bottom: 25px;
  }
  .main-title {
    font-size: 54px;
    font-weight: 900;
    color: #1e293b;
    line-height: 1.32;
    letter-spacing: -2px;
  }
  .main-title .hl {
    color: ${T.accent};
    position: relative;
    display: inline-block;
  }
  .main-title .hl::after {
    content: '';
    position: absolute;
    bottom: 4px;
    left: -6px;
    right: -6px;
    height: 15px;
    background: ${T.accentLight};
    border-radius: 4px;
    z-index: -1;
  }
  .sub-title {
    font-size: 25px;
    font-weight: 400;
    color: #64748b;
    margin-top: 18px;
    line-height: 1.55;
    letter-spacing: -0.3px;
  }

  /* ── 폰 + 사이드 체크리스트 ── */
  .phone-wrap {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: 20px;
  }
  .side-checklist {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 80px;
  }
  .side-check-item {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255,255,255,0.85);
    border: 2px solid ${T.accent};
    border-radius: 16px;
    padding: 12px 18px;
    box-shadow: 0 3px 12px rgba(0,0,0,0.06);
    white-space: nowrap;
  }
  .side-check-icon {
    font-size: 28px;
    flex-shrink: 0;
  }
  .side-check-text {
    font-size: 20px;
    font-weight: 700;
    color: #1e293b;
  }
  .side-check-mark {
    font-size: 26px;
    flex-shrink: 0;
    margin-left: auto;
  }
  .phone {
    width: 484px;
    border-radius: 46px;
    border: 5px solid #d1d5db;
    overflow: hidden;
    box-shadow:
      0 10px 40px rgba(0,0,0,0.08),
      0 2px 8px rgba(0,0,0,0.04);
    background: #fff;
  }
  .phone img {
    display: block;
    width: 100%;
    height: auto;
  }

  /* ── 확대경 (돋보기) ── */
  .magnifier {
    position: absolute;
    width: 280px;
    height: 280px;
    border-radius: 50%;
    border: 4px solid ${T.accent};
    overflow: hidden;
    z-index: 3;
    box-shadow: 0 6px 24px rgba(0,0,0,0.15), 0 0 0 6px rgba(255,255,255,0.8);
    background: white;
  }
  .magnifier img {
    position: absolute;
    display: block;
  }
  .magnifier-handle {
    position: absolute;
    width: 8px;
    height: 60px;
    background: linear-gradient(180deg, ${T.accent}, ${T.shadow3d1});
    border-radius: 4px;
    z-index: 3;
    transform: rotate(-35deg);
    box-shadow: 2px 2px 4px rgba(0,0,0,0.2);
  }

  /* ── 추천 대상 ── */
  .recommend {
    width: fit-content;
    max-width: 95%;
    margin: 0 auto;
    padding: 0;
    text-align: left;
    margin-top: 70px;
  }
  .recommend-title {
    font-size: 25px;
    font-weight: 800;
    color: #1e293b;
    margin-bottom: 10px;
    white-space: nowrap;
  }
  .recommend-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .recommend-item {
    font-size: 25px;
    font-weight: 400;
    color: #64748b;
    line-height: 1.5;
    white-space: nowrap;
  }

  /* ── 로고 (footer 고정) ── */
  .logo-area {
    position: absolute;
    bottom: 35px;
    left: 0;
    right: 0;
    z-index: 2;
    display: flex;
    justify-content: center;
  }
  .badges {
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .badge {
    background: #ffffff;
    border: 1.5px solid ${T.badgeBorder};
    border-radius: 14px;
    padding: 10px 18px;
    font-size: 17px;
    font-weight: 700;
    color: #334155;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0,168,132,0.05);
  }
  .logo-bottom {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo-bottom img {
    width: 36px;
    height: 36px;
  }
  .logo-text {
    font-size: 34px;
    font-weight: 900;
    color: ${T.accent};
    letter-spacing: 0.5px;
    text-shadow:
      1px 1px 0px ${T.shadow3d1},
      2px 2px 0px ${T.shadow3d2},
      3px 3px 6px rgba(0,0,0,0.15);
  }
</style>
</head>
<body>

<!-- 배경 장식 -->
<div class="bg-orb o1"></div>
<div class="bg-orb o2"></div>
<div class="bg-orb o3"></div>
<div class="deco d1"></div>
<div class="deco d2"></div>
<div class="deco d3"></div>
<div class="deco d4"></div>
<div class="deco d5"></div>

<!-- 상단 카피 -->
<div class="top-copy">
  <div class="main-title">${titleLines}</div>
  <div class="sub-title">${subtitleHTML}</div>
</div>

<!-- 폰 + 사이드 -->
<div class="phone-wrap">
  <div class="phone" style="position:relative; overflow:visible;">
    <img src="${screenshotDataUri}" alt="app screenshot" style="border-radius:42px;" />
    ${glowHTML}
    ${starsHTML}
  </div>
  ${sideCheckHTML}
</div>

<!-- 추천 대상 (폰 바로 아래) -->
<div class="recommend">
  <div class="recommend-title">${recommendTitle}</div>
  <div class="recommend-list">
    ${recommendItems.map(item => `<div class="recommend-item">${item}</div>`).join('\n    ')}
  </div>
</div>

<!-- 로고 -->
<div class="logo-area">
  <div class="logo-bottom">
    <img src="data:image/png;base64,LOGO_PLACEHOLDER" alt="" />
    <span class="logo-text">PronunFit</span>
  </div>
</div>

</body>
</html>`;
}

// ── 메인 ──
async function main() {
  const args = parseArgs();
  const configNum = parseInt(args.config);

  let title, highlight, subtitle, badges, screenshotFile, outputFile, recommendTitle, recommendItems;

  // 기본 추천 문구
  const defaultRecommend = {
    title: '⭐⭐ 이런 분들께 딱! 맞는 앱입니다',
    items: [
      '✅ 기존 앱의 진도가 너무 느려 답답함을 느끼시는 분',
      '✅ 다국어 학습이 절실하게 필요하신 분',
      '✅ 데이터에 기반한 정밀한 발음 교정을 원하시는 분',
      '✅ 나만의 학습 스케줄로 주도적인 공부를 하는 스스로 학습자',
    ],
  };

  if (configNum && PRESETS[configNum]) {
    const p = PRESETS[configNum];
    console.log(`═══ [${configNum}] ${p.name} ═══`);
    title = args.title?.replaceAll('\\n', '\n') || p.title;
    highlight = args.highlight || p.highlight;
    subtitle = args.subtitle?.replaceAll('\\n', '\n') || p.subtitle;
    badges = args.badges ? args.badges.split(',') : p.badges;
    screenshotFile = args.screenshot || 'app_screenshot.png';
    outputFile = args.output || `promo_${String(configNum).padStart(2, '0')}_${p.name}.png`;
    recommendTitle = p.recommendTitle || defaultRecommend.title;
    recommendItems = p.recommendItems || defaultRecommend.items;
  } else {
    title = (args.title || 'Title').replaceAll('\\n', '\n');
    highlight = args.highlight || '';
    subtitle = (args.subtitle || 'Subtitle').replaceAll('\\n', '\n');
    badges = args.badges ? args.badges.split(',').map(b => b.trim()) : [];
    screenshotFile = args.screenshot || 'app_screenshot.png';
    outputFile = args.output || `promo_custom.png`;
    recommendTitle = defaultRecommend.title;
    recommendItems = defaultRecommend.items;
  }

  // CLI에서 추천 문구 오버라이드
  if (args['recommend-title']) recommendTitle = args['recommend-title'];
  if (args['recommend-items']) recommendItems = args['recommend-items'].split('|');

  const theme = args.theme || 'green';
  const glowPos = args['glow-pos'] || '';

  // 스크린샷 → data URI
  const ssPath = path.resolve(__dirname, screenshotFile);
  if (!fs.existsSync(ssPath)) {
    console.error(`❌ 스크린샷 없음: ${ssPath}`);
    process.exit(1);
  }
  const ssData = fs.readFileSync(ssPath);
  const ssExt = path.extname(ssPath).slice(1) === 'jpg' ? 'jpeg' : 'png';
  const screenshotDataUri = `data:image/${ssExt};base64,${ssData.toString('base64')}`;
  console.log(`  📱 스크린샷: ${ssPath}`);

  // 로고 → data URI
  const logoPath = path.resolve(__dirname, 'logo.png');
  let logoB64 = '';
  if (fs.existsSync(logoPath)) {
    logoB64 = fs.readFileSync(logoPath).toString('base64');
  }

  // HTML 생성
  // 사이드 체크리스트 파싱 (--side-checklist "📖:Vocabulary,💬:Dialogue,...")
  let sideChecklist = [];
  if (args['side-checklist']) {
    sideChecklist = args['side-checklist'].split(',').map(s => {
      const [icon, text] = s.trim().split(':');
      return { icon: icon.trim(), text: text.trim() };
    });
  }

  // 별표 위치 파싱 (--stars "0.28,0.36,0.44,0.52,0.60,0.68")
  const starPositions = args.stars ? args.stars.split(',').map(s => parseFloat(s.trim())) : [];

  let html = generateHTML({ title, highlight, subtitle, badges, screenshotDataUri, recommendTitle, recommendItems, theme, glowPos, sideChecklist, starPositions });
  html = html.replace('LOGO_PLACEHOLDER', logoB64);

  // 임시 HTML 저장
  const tmpHtml = path.resolve(__dirname, '_tmp_promo.html');
  fs.writeFileSync(tmpHtml, html, 'utf8');

  // Puppeteer 캡처
  console.log('  🖼️  캡처 중...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 1500));

  const outPath = path.resolve(__dirname, outputFile);
  await page.screenshot({ path: outPath, type: 'png', fullPage: false });
  await browser.close();

  // 임시 파일 삭제
  fs.unlinkSync(tmpHtml);

  console.log(`\n  🎉 완료: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
