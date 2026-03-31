/**
 * Promo_01: 6개 언어별 홍보 이미지 일괄 생성
 */
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generator = path.resolve(__dirname, 'generate.mjs');
const ssDir = path.resolve(__dirname, 'Promo_01');
const outDir = path.resolve(__dirname, 'Promo_01', 'output');

import fs from 'fs';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const LANGS = [
  {
    code: 'ko',
    screenshot: 'app_screenshot_ko.png',
    title: '당신이 직접 설계하는\\n언어 학습의 혁명',
    highlight: '혁명',
    subtitle: '짜여진 시나리오대로, 알려주는 문장만 학습해서\\n언제 언어를 마스터 할 수 있을까요?',
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
    screenshot: 'app_screenshot_en.png',
    title: 'A Revolution in\\nSelf-Directed Language Learning',
    highlight: 'Revolution',
    subtitle: 'How long will you master a language\\nby only studying scripted sentences?',
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
    screenshot: 'app_screenshot_jp.png',
    title: '自分で設計する\\n語学学習の革命',
    highlight: '革命',
    subtitle: '決められたシナリオ通りの文だけ学んで\\nいつ言語をマスターできますか？',
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
    screenshot: 'app_screenshot_es.png',
    title: 'Una Revolución en el\\nAprendizaje Autodidacta',
    highlight: 'Revolución',
    subtitle: '¿Cuánto tiempo dominarás un idioma\\nestudiando solo frases predefinidas?',
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
    screenshot: 'app_screenshot_ru.png',
    title: 'Революция в\\nсамостоятельном изучении языков',
    highlight: 'Революция',
    subtitle: 'Сколько можно учить язык\\nпо заготовленным сценариям?',
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
    screenshot: 'app_screenshot_vn.png',
    title: 'Cuộc Cách Mạng\\nTự Học Ngôn Ngữ',
    highlight: 'Cách Mạng',
    subtitle: 'Học mãi theo kịch bản có sẵn\\nbao giờ mới thành thạo ngôn ngữ?',
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

  const ssPath = path.resolve(ssDir, lang.screenshot);
  const outPath = path.resolve(outDir, `promo_01_${lang.code}.png`);

  const cmd = [
    'node', `"${generator}"`,
    '--screenshot', `"${ssPath}"`,
    '--title', `"${lang.title}"`,
    '--highlight', `"${lang.highlight}"`,
    '--subtitle', `"${lang.subtitle}"`,
    '--recommend-title', `"${lang.recommendTitle}"`,
    '--recommend-items', `"${lang.recommendItems.join('|')}"`,
    '--output', `"${outPath}"`,
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'inherit', encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  } catch (e) {
    console.error(`  ❌ ${lang.code} 실패:`, e.message);
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log('🎉 모든 언어 생성 완료!');
console.log(`   출력 폴더: ${outDir}`);
