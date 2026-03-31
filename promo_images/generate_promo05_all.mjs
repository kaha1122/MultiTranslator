import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generator = path.resolve(__dirname, 'generate.mjs');
const ssDir = path.resolve(__dirname, 'Promo_05');
const outDir = path.resolve(__dirname, 'Promo_05', 'output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const STARS = '0.34,0.44,0.54,0.64,0.74,0.83';

const LANGS = [
  {
    code: 'ko', screenshot: 'shot05_kr.png',
    title: '거품은 빼고 실력만 채운\\n압도적 가성비',
    highlight: '압도적 가성비',
    subtitle: '화려한 그래픽 대신 본질적인 학습 효과에 집중하여\\n총 6가지 메뉴를 압도적으로 저렴하게 사용할 수 있어요',
    rTitle: '⭐⭐ 이런 분들께 딱! 맞는 앱입니다',
    rItems: ['✅ 기존 앱의 진도가 너무 느려 답답함을 느끼시는 분','✅ 다국어 학습이 절실하게 필요하신 분','✅ 데이터에 기반한 정밀한 발음 교정을 원하시는 분','✅ 나만의 학습 스케줄로 주도적인 공부를 하는 스스로 학습자'],
  },
  {
    code: 'en', screenshot: 'shot05_en.png',
    title: 'No Frills, Just Skills:\\nOverwhelming Value',
    highlight: 'Overwhelming Value',
    subtitle: 'Focused on real learning outcomes, not flashy graphics.\\nAll 6 features at an unbeatable price',
    rTitle: '⭐⭐ Perfect for learners who want:',
    rItems: ['✅ Faster progress than traditional apps offer','✅ Multi-language learning in one place','✅ Data-driven, precise pronunciation coaching','✅ A self-paced schedule for independent study'],
  },
  {
    code: 'jp', screenshot: 'shot05_jp.png',
    title: '無駄を省いて実力だけを\\n圧倒的コストパフォーマンス',
    highlight: 'コストパフォーマンス',
    subtitle: '派手なグラフィックより本質的な学習効果に集中\\n6つの全メニューを圧倒的な低価格で',
    rTitle: '⭐⭐ こんな方にぴったりのアプリです',
    rItems: ['✅ 既存アプリの進度が遅くてもどかしい方','✅ 多言語学習が切実に必要な方','✅ データに基づく精密な発音矯正を求める方','✅ 自分のスケジュールで主体的に学ぶ学習者'],
  },
  {
    code: 'es', screenshot: 'shot05_es.png',
    title: 'Sin adornos, solo habilidades:\\nValor Abrumador',
    highlight: 'Valor Abrumador',
    subtitle: 'Enfocado en resultados reales de aprendizaje.\\n6 funciones completas a un precio imbatible',
    rTitle: '⭐⭐ Perfecto para quienes buscan:',
    rItems: ['✅ Progreso más rápido que las apps tradicionales','✅ Aprendizaje multilingüe en un solo lugar','✅ Corrección de pronunciación precisa con IA','✅ Un horario propio para estudiar a su ritmo'],
  },
  {
    code: 'ru', screenshot: 'shot05_ru.png',
    title: 'Без лишнего — только навыки:\\nмаксимальная выгода',
    highlight: 'максимальная выгода',
    subtitle: 'Фокус на реальном результате обучения.\\nВсе 6 функций по непревзойдённой цене',
    rTitle: '⭐⭐ Идеально подходит тем, кто:',
    rItems: ['✅ Устал от медленного прогресса в других приложениях','✅ Нуждается в изучении нескольких языков','✅ Хочет точную коррекцию произношения на основе данных','✅ Предпочитает самостоятельный график обучения'],
  },
  {
    code: 'vn', screenshot: 'shot05_vn.png',
    title: 'Bỏ hào nhoáng, giữ thực lực:\\nGiá Trị Vượt Trội',
    highlight: 'Giá Trị Vượt Trội',
    subtitle: 'Tập trung vào hiệu quả học tập thực sự.\\n6 tính năng đầy đủ với mức giá không thể tốt hơn',
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
    '--subtitle', `"${lang.subtitle}"`, '--theme', 'gold',
    '--stars', `"${STARS}"`,
    '--recommend-title', `"${lang.rTitle}"`,
    '--recommend-items', `"${lang.rItems.join('|')}"`,
    '--output', `"${path.resolve(outDir, `promo_05_${lang.code}.png`)}"`,
  ].join(' ');
  try { execSync(cmd, { stdio: 'inherit' }); } catch(e) { console.error(`  ❌ ${lang.code}`, e.message); }
}

// 2. 리사이즈
console.log('\n  📐 리사이즈...');
execSync(`python -c "
from PIL import Image; import os
SIZES=[(1080,1920),(1242,2208),(1290,2796)]
for lang in ['ko','en','jp','es','ru','vn']:
    src=os.path.join('${outDir.replace(/\\/g,'/')}',f'promo_05_{lang}.png')
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
        r.save(os.path.join(od,f'promo_05_{lang}_{w}x{h}.png'),'PNG',quality=95)
    print(f'  ✅ {lang.upper()} - 3 sizes')
"`, { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

console.log('\n🎉 Promo_05 완료! (6언어 × 3사이즈)');
