import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generator = path.resolve(__dirname, 'generate.mjs');
const ssDir = path.resolve(__dirname, 'Promo_04');
const outDir = path.resolve(__dirname, 'Promo_04', 'output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const LANGS = [
  {
    code: 'ko', screenshot: 'screenshot_kr.png',
    title: '하나를 배울 때 셋을 얻는\\n압도적 효율의 다국어 동시 학습',
    highlight: '다국어 동시 학습',
    subtitle: '업계 유일의 3개 국어 동시 학습 지원으로\\n언어간 교차 학습이 가능해요. 학습 속도를 3배 높이세요',
    rTitle: '⭐⭐ 이런 분들께 딱! 맞는 앱입니다',
    rItems: ['✅ 기존 앱의 진도가 너무 느려 답답함을 느끼시는 분','✅ 다국어 학습이 절실하게 필요하신 분','✅ 데이터에 기반한 정밀한 발음 교정을 원하시는 분','✅ 나만의 학습 스케줄로 주도적인 공부를 하는 스스로 학습자'],
  },
  {
    code: 'en', screenshot: 'screenshot_en.png',
    title: 'Learn One, Gain Three:\\nOverwhelming Multi-Language Efficiency',
    highlight: 'Multi-Language Efficiency',
    subtitle: 'The only app supporting 3 languages simultaneously.\\nCross-language learning triples your speed',
    rTitle: '⭐⭐ Perfect for learners who want:',
    rItems: ['✅ Faster progress than traditional apps offer','✅ Multi-language learning in one place','✅ Data-driven, precise pronunciation coaching','✅ A self-paced schedule for independent study'],
  },
  {
    code: 'jp', screenshot: 'screenshot_jp.png',
    title: 'ひとつ学べば三つ得られる\\n圧倒的効率の多言語同時学習',
    highlight: '多言語同時学習',
    subtitle: '業界唯一の3か国語同時学習対応で\\n言語間クロス学習が可能。学習速度を3倍に',
    rTitle: '⭐⭐ こんな方にぴったりのアプリです',
    rItems: ['✅ 既存アプリの進度が遅くてもどかしい方','✅ 多言語学習が切実に必要な方','✅ データに基づく精密な発音矯正を求める方','✅ 自分のスケジュールで主体的に学ぶ学習者'],
  },
  {
    code: 'es', screenshot: 'screenshot_es.png',
    title: 'Aprende Uno, Gana Tres:\\nEficiencia Multilingüe Abrumadora',
    highlight: 'Multilingüe',
    subtitle: 'La única app con aprendizaje simultáneo de 3 idiomas.\\nEl aprendizaje cruzado triplica tu velocidad',
    rTitle: '⭐⭐ Perfecto para quienes buscan:',
    rItems: ['✅ Progreso más rápido que las apps tradicionales','✅ Aprendizaje multilingüe en un solo lugar','✅ Corrección de pronunciación precisa con IA','✅ Un horario propio para estudiar a su ritmo'],
  },
  {
    code: 'ru', screenshot: 'screenshot_ru.png',
    title: 'Учите один — получайте три:\\nмногоязычное обучение',
    highlight: 'многоязычное обучение',
    subtitle: 'Единственное приложение с одновременным изучением 3 языков.\\nПерекрёстное обучение утраивает скорость',
    rTitle: '⭐⭐ Идеально подходит тем, кто:',
    rItems: ['✅ Устал от медленного прогресса в других приложениях','✅ Нуждается в изучении нескольких языков','✅ Хочет точную коррекцию произношения на основе данных','✅ Предпочитает самостоятельный график обучения'],
  },
  {
    code: 'vn', screenshot: 'screenshot_vn.png',
    title: 'Học Một, Được Ba:\\nHiệu Quả Đa Ngôn Ngữ Vượt Trội',
    highlight: 'Đa Ngôn Ngữ',
    subtitle: 'Ứng dụng duy nhất hỗ trợ học 3 ngôn ngữ cùng lúc.\\nHọc chéo ngôn ngữ giúp tăng tốc gấp 3 lần',
    rTitle: '⭐⭐ Ứng dụng hoàn hảo cho bạn nếu:',
    rItems: ['✅ Thấy các ứng dụng khác tiến độ quá chậm','✅ Cần học nhiều ngôn ngữ cùng lúc','✅ Muốn sửa phát âm chính xác dựa trên dữ liệu AI','✅ Thích tự chủ lịch học theo tốc độ riêng'],
  },
];

// 1. 이미지 생성
for (const lang of LANGS) {
  console.log(`\n  🌐 ${lang.code.toUpperCase()}`);
  const cmd = [
    'node', `"${generator}"`,
    '--screenshot', `"${path.resolve(ssDir, lang.screenshot)}"`,
    '--title', `"${lang.title}"`, '--highlight', `"${lang.highlight}"`,
    '--subtitle', `"${lang.subtitle}"`, '--theme', 'peach',
    '--glow-pos', '0.16',
    '--recommend-title', `"${lang.rTitle}"`,
    '--recommend-items', `"${lang.rItems.join('|')}"`,
    '--output', `"${path.resolve(outDir, `promo_04_${lang.code}.png`)}"`,
  ].join(' ');
  try { execSync(cmd, { stdio: 'inherit' }); } catch(e) { console.error(`  ❌ ${lang.code}`, e.message); }
}

// 2. 리사이즈
console.log('\n  📐 리사이즈...');
execSync(`python -c "
from PIL import Image; import os
SIZES=[(1080,1920),(1242,2208),(1290,2796)]
for lang in ['ko','en','jp','es','ru','vn']:
    src=os.path.join('${outDir.replace(/\\/g,'/')}',f'promo_04_{lang}.png')
    if not os.path.exists(src): continue
    od=os.path.join('${outDir.replace(/\\/g,'/')}',lang); os.makedirs(od,exist_ok=True)
    img=Image.open(src).convert('RGB')
    for w,h in SIZES:
        if w==img.width and h==img.height: r=img.copy()
        else:
            sr=img.width/img.height;tr=w/h
            if sr>tr: nw,nh=w,int(w/sr)
            else: nh,nw=h,int(h*sr)
            r=img.resize((nw,nh),Image.LANCZOS);bg=img.getpixel((10,10))
            c=Image.new('RGB',(w,h),bg);c.paste(r,((w-nw)//2,(h-nh)//2));r=c
        r.save(os.path.join(od,f'promo_04_{lang}_{w}x{h}.png'),'PNG',quality=95)
    print(f'  ✅ {lang.upper()} - 3 sizes')
"`, { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

console.log('\n🎉 Promo_04 완료! (6언어 × 3사이즈)');
