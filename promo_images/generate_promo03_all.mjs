/**
 * Promo_03: 6개 언어별 홍보 이미지 생성 (무한 커리큘럼) + 3사이즈 리사이즈
 */
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generator = path.resolve(__dirname, 'generate.mjs');
const ssDir = path.resolve(__dirname, 'Promo_03');
const outDir = path.resolve(__dirname, 'Promo_03', 'output');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const LANGS = [
  {
    code: 'ko', screenshot: 'Prmo2_kr.png',
    title: 'AI가 실시간으로 생성하는\\n무한 커리큘럼',
    highlight: '무한 커리큘럼',
    subtitle: '70개 카테고리와 22가지 실전 상황, 당신의 레벨에 맞춰\\n끊임없이 업데이트되는 지능형 데이터',
    recommendTitle: '⭐⭐ 이런 분들께 딱! 맞는 앱입니다',
    recommendItems: [
      '✅ 기존 앱의 진도가 너무 느려 답답함을 느끼시는 분',
      '✅ 다국어 학습이 절실하게 필요하신 분',
      '✅ 데이터에 기반한 정밀한 발음 교정을 원하시는 분',
      '✅ 나만의 학습 스케줄로 주도적인 공부를 하는 스스로 학습자',
    ],
  },
  {
    code: 'en', screenshot: 'Prmo2_en.png',
    title: 'AI-Generated\\nUnlimited Curriculum',
    highlight: 'Unlimited Curriculum',
    subtitle: '70 categories and 22 real-life scenarios,\\nconstantly updated to match your level',
    recommendTitle: '⭐⭐ Perfect for learners who want:',
    recommendItems: [
      '✅ Faster progress than traditional apps offer',
      '✅ Multi-language learning in one place',
      '✅ Data-driven, precise pronunciation coaching',
      '✅ A self-paced schedule for independent study',
    ],
  },
  {
    code: 'jp', screenshot: 'Prmo2_jp.png',
    title: 'AIがリアルタイムで生成する\\n無限カリキュラム',
    highlight: '無限カリキュラム',
    subtitle: '70カテゴリと22の実践シナリオ\\nあなたのレベルに合わせて常にアップデート',
    recommendTitle: '⭐⭐ こんな方にぴったりのアプリです',
    recommendItems: [
      '✅ 既存アプリの進度が遅くてもどかしい方',
      '✅ 多言語学習が切実に必要な方',
      '✅ データに基づく精密な発音矯正を求める方',
      '✅ 自分のスケジュールで主体的に学ぶ学習者',
    ],
  },
  {
    code: 'es', screenshot: 'Prmo2_es.png',
    title: 'Currículo Ilimitado\\nGenerado por IA',
    highlight: 'Ilimitado',
    subtitle: '70 categorías y 22 escenarios reales,\\nactualizados constantemente a tu nivel',
    recommendTitle: '⭐⭐ Perfecto para quienes buscan:',
    recommendItems: [
      '✅ Progreso más rápido que las apps tradicionales',
      '✅ Aprendizaje multilingüe en un solo lugar',
      '✅ Corrección de pronunciación precisa con IA',
      '✅ Un horario propio para estudiar a su ritmo',
    ],
  },
  {
    code: 'ru', screenshot: 'Prmo2_ru.png',
    title: 'Безграничная программа\\nсоздаваемая ИИ в реальном времени',
    highlight: 'Безграничная программа',
    subtitle: '70 категорий и 22 реальных сценария,\\nпостоянно обновляемых под ваш уровень',
    recommendTitle: '⭐⭐ Идеально подходит тем, кто:',
    recommendItems: [
      '✅ Устал от медленного прогресса в других приложениях',
      '✅ Нуждается в изучении нескольких языков',
      '✅ Хочет точную коррекцию произношения на основе данных',
      '✅ Предпочитает самостоятельный график обучения',
    ],
  },
  {
    code: 'vn', screenshot: 'Prmo2_vn.png',
    title: 'Giáo Trình Vô Hạn\\nDo AI Tạo Thời Gian Thực',
    highlight: 'Vô Hạn',
    subtitle: '70 danh mục và 22 tình huống thực tế,\\nliên tục cập nhật theo trình độ của bạn',
    recommendTitle: '⭐⭐ Ứng dụng hoàn hảo cho bạn nếu:',
    recommendItems: [
      '✅ Thấy các ứng dụng khác tiến độ quá chậm',
      '✅ Cần học nhiều ngôn ngữ cùng lúc',
      '✅ Muốn sửa phát âm chính xác dựa trên dữ liệu AI',
      '✅ Thích tự chủ lịch học theo tốc độ riêng',
    ],
  },
];

// ── 1단계: 6개 언어 이미지 생성 ──
for (const lang of LANGS) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  🌐 ${lang.code.toUpperCase()}`);

  const ssPath = path.resolve(ssDir, lang.screenshot);
  const outPath = path.resolve(outDir, `promo_03_${lang.code}.png`);

  const cmd = [
    'node', `"${generator}"`,
    '--screenshot', `"${ssPath}"`,
    '--title', `"${lang.title}"`,
    '--highlight', `"${lang.highlight}"`,
    '--subtitle', `"${lang.subtitle}"`,
    '--theme', 'purple',
    '--recommend-title', `"${lang.recommendTitle}"`,
    '--recommend-items', `"${lang.recommendItems.join('|')}"`,
    '--output', `"${outPath}"`,
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'inherit', encoding: 'utf8' });
  } catch (e) {
    console.error(`  ❌ ${lang.code} 실패:`, e.message);
  }
}

// ── 2단계: 3사이즈 리사이즈 ──
console.log(`\n${'='.repeat(50)}`);
console.log('  📐 리사이즈 진행...');

const resizeCmd = `python -c "
from PIL import Image
import os

SIZES = [(1080, 1920), (1242, 2208), (1290, 2796)]
LANGS = ['ko', 'en', 'jp', 'es', 'ru', 'vn']
src_dir = '${outDir.replace(/\\/g, '/')}'

def fit_expand(img, tw, th):
    sr = img.width / img.height
    tr = tw / th
    if sr > tr:
        nw, nh = tw, int(tw / sr)
    else:
        nh, nw = th, int(th * sr)
    resized = img.resize((nw, nh), Image.LANCZOS)
    bg = img.getpixel((10, 10))
    canvas = Image.new('RGB', (tw, th), bg)
    canvas.paste(resized, ((tw - nw) // 2, (th - nh) // 2))
    return canvas

for lang in LANGS:
    src = os.path.join(src_dir, f'promo_03_{lang}.png')
    if not os.path.exists(src): continue
    out_dir = os.path.join(src_dir, lang)
    os.makedirs(out_dir, exist_ok=True)
    img = Image.open(src).convert('RGB')
    for w, h in SIZES:
        result = img.copy() if (w == img.width and h == img.height) else fit_expand(img, w, h)
        result.save(os.path.join(out_dir, f'promo_03_{lang}_{w}x{h}.png'), 'PNG', quality=95)
    print(f'  ✅ {lang.upper()} - 3 sizes')
"`;

try {
  execSync(resizeCmd, { stdio: 'inherit', encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
} catch (e) {
  console.error('  ❌ 리사이즈 실패:', e.message);
}

console.log(`\n${'='.repeat(50)}`);
console.log('🎉 Promo_03 완료! (6언어 × 3사이즈 = 18개)');
console.log(`   출력: ${outDir}`);
