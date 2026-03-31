/**
 * Promo_02: 6개 언어별 홍보 이미지 생성 (초정밀 발음 교정)
 * 동일한 스크린샷 + 언어별 텍스트
 */
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generator = path.resolve(__dirname, 'generate.mjs');
const screenshot = path.resolve(__dirname, 'Promo_02.png');
const outDir = path.resolve(__dirname, 'Promo_02', 'output');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const LANGS = [
  {
    code: 'ko',
    title: '음소 단위까지 쪼개어\\n완성하는 완벽 발음',
    highlight: '완벽 발음',
    subtitle: '단순한 비교가 아닙니다. AI가 당신의 목소리를\\n음절 단위로 분석하여 짚어주는 디테일한 피드백',
    recommendTitle: '⭐⭐ 이런 분들께 딱! 맞는 앱입니다',
    recommendItems: [
      '✅ 기존 앱의 진도가 너무 느려 답답함을 느끼시는 분',
      '✅ 다국어 학습이 절실하게 필요하신 분',
      '✅ 데이터에 기반한 정밀한 발음 교정을 원하시는 분',
      '✅ 나만의 학습 스케줄로 주도적인 공부를 하는 스스로 학습자',
    ],
  },
  {
    code: 'en',
    title: 'Perfect Pronunciation\\nDown to Every Phoneme',
    highlight: 'Perfect Pronunciation',
    subtitle: "Not just simple comparison. AI analyzes your voice\\nsyllable by syllable with detailed feedback",
    recommendTitle: '⭐⭐ Perfect for learners who want:',
    recommendItems: [
      '✅ Faster progress than traditional apps offer',
      '✅ Multi-language learning in one place',
      '✅ Data-driven, precise pronunciation coaching',
      '✅ A self-paced schedule for independent study',
    ],
  },
  {
    code: 'jp',
    title: '音素単位まで分解して\\n完成する完璧な発音',
    highlight: '完璧な発音',
    subtitle: '単純な比較ではありません。AIがあなたの声を\\n音節単位で分析する詳細なフィードバック',
    recommendTitle: '⭐⭐ こんな方にぴったりのアプリです',
    recommendItems: [
      '✅ 既存アプリの進度が遅くてもどかしい方',
      '✅ 多言語学習が切実に必要な方',
      '✅ データに基づく精密な発音矯正を求める方',
      '✅ 自分のスケジュールで主体的に学ぶ学習者',
    ],
  },
  {
    code: 'es',
    title: 'Pronunciación Perfecta\\nHasta Cada Fonema',
    highlight: 'Perfecta',
    subtitle: 'No es solo una comparación simple. La IA analiza tu voz\\nsílaba por sílaba con feedback detallado',
    recommendTitle: '⭐⭐ Perfecto para quienes buscan:',
    recommendItems: [
      '✅ Progreso más rápido que las apps tradicionales',
      '✅ Aprendizaje multilingüe en un solo lugar',
      '✅ Corrección de pronunciación precisa con IA',
      '✅ Un horario propio para estudiar a su ritmo',
    ],
  },
  {
    code: 'ru',
    title: 'Идеальное произношение\\nс точностью до фонемы',
    highlight: 'Идеальное произношение',
    subtitle: 'Не просто сравнение. ИИ анализирует ваш голос\\nпослогово с детальной обратной связью',
    recommendTitle: '⭐⭐ Идеально подходит тем, кто:',
    recommendItems: [
      '✅ Устал от медленного прогресса в других приложениях',
      '✅ Нуждается в изучении нескольких языков',
      '✅ Хочет точную коррекцию произношения на основе данных',
      '✅ Предпочитает самостоятельный график обучения',
    ],
  },
  {
    code: 'vn',
    title: 'Phát Âm Hoàn Hảo\\nĐến Từng Âm Vị',
    highlight: 'Hoàn Hảo',
    subtitle: 'Không chỉ là so sánh đơn giản. AI phân tích giọng bạn\\ntheo từng âm tiết với phản hồi chi tiết',
    recommendTitle: '⭐⭐ Ứng dụng hoàn hảo cho bạn nếu:',
    recommendItems: [
      '✅ Thấy các ứng dụng khác tiến độ quá chậm',
      '✅ Cần học nhiều ngôn ngữ cùng lúc',
      '✅ Muốn sửa phát âm chính xác dựa trên dữ liệu AI',
      '✅ Thích tự chủ lịch học theo tốc độ riêng',
    ],
  },
];

for (const lang of LANGS) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  🌐 ${lang.code.toUpperCase()}`);
  console.log('='.repeat(50));

  const outPath = path.resolve(outDir, `promo_02_${lang.code}.png`);

  const cmd = [
    'node', `"${generator}"`,
    '--screenshot', `"${screenshot}"`,
    '--title', `"${lang.title}"`,
    '--highlight', `"${lang.highlight}"`,
    '--subtitle', `"${lang.subtitle}"`,
    '--theme', 'blue',
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

console.log(`\n${'='.repeat(50)}`);
console.log('🎉 Promo_02 모든 언어 생성 완료!');
console.log(`   출력 폴더: ${outDir}`);
