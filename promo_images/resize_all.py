"""
6개 언어별 3가지 사이즈 생성 (비율 유지 확대, 배경색 채움)
"""

from PIL import Image
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.join(SCRIPT_DIR, 'Promo_01', 'output')

SIZES = [
    (1080, 1920),
    (1242, 2208),
    (1290, 2796),
]

LANGS = ['ko', 'en', 'jp', 'es', 'ru', 'vn']


def fit_expand(img, target_w, target_h):
    """비율 유지 확대, 빈 공간은 배경색으로 채움"""
    src_ratio = img.width / img.height
    tgt_ratio = target_w / target_h

    if src_ratio > tgt_ratio:
        new_w = target_w
        new_h = int(target_w / src_ratio)
    else:
        new_h = target_h
        new_w = int(target_h * src_ratio)

    resized = img.resize((new_w, new_h), Image.LANCZOS)

    bg_color = img.getpixel((10, 10))
    canvas = Image.new('RGB', (target_w, target_h), bg_color)
    x = (target_w - new_w) // 2
    y = (target_h - new_h) // 2
    canvas.paste(resized, (x, y))
    return canvas


for lang in LANGS:
    src_path = os.path.join(SOURCE_DIR, f'promo_01_{lang}.png')
    if not os.path.exists(src_path):
        print(f"  ❌ {lang}: 원본 없음")
        continue

    out_dir = os.path.join(SOURCE_DIR, lang)
    os.makedirs(out_dir, exist_ok=True)

    img = Image.open(src_path).convert('RGB')
    print(f"\n🌐 {lang.upper()}")

    for w, h in SIZES:
        if w == img.width and h == img.height:
            result = img.copy()
        else:
            result = fit_expand(img, w, h)

        out_path = os.path.join(out_dir, f'promo_01_{lang}_{w}x{h}.png')
        result.save(out_path, 'PNG', quality=95)
        print(f"  ✅ {w}x{h} -> {os.path.basename(out_path)}")

print("\n🎉 완료!")
