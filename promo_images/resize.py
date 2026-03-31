"""
홍보 이미지 리사이즈/크롭 스크립트
원본 1080x1920 기준으로 다양한 사이즈 생성
"""

from PIL import Image
import os
import sys

SIZES = {
    'playstore_screenshot':   (1080, 1920, '그대로'),
    'playstore_feature':      (1024, 500,  '가로 크롭'),
    'appstore_67':            (1290, 2796, '비율 확대'),
    'appstore_55':            (1242, 2208, '비율 확대'),
    'sns_square':             (1080, 1080, '정사각 크롭'),
    'sns_story':              (1080, 1920, '그대로'),
    'web_banner':             (1200, 628,  '가로 크롭'),
}


def crop_center(img, target_w, target_h):
    """중앙 기준 크롭"""
    src_ratio = img.width / img.height
    tgt_ratio = target_w / target_h

    if src_ratio < tgt_ratio:
        # 원본이 더 세로 → 좌우 맞추고 상하 크롭
        new_w = img.width
        new_h = int(new_w / tgt_ratio)
        top = (img.height - new_h) // 4  # 상단 쪽으로 치우쳐 크롭 (제목 보존)
        cropped = img.crop((0, top, new_w, top + new_h))
    else:
        # 원본이 더 가로 → 상하 맞추고 좌우 크롭
        new_h = img.height
        new_w = int(new_h * tgt_ratio)
        left = (img.width - new_w) // 2
        cropped = img.crop((left, 0, left + new_w, new_h))

    return cropped.resize((target_w, target_h), Image.LANCZOS)


def fit_expand(img, target_w, target_h):
    """비율 유지하며 확대, 빈 공간은 배경색으로 채움"""
    src_ratio = img.width / img.height
    tgt_ratio = target_w / target_h

    if src_ratio > tgt_ratio:
        new_w = target_w
        new_h = int(target_w / src_ratio)
    else:
        new_h = target_h
        new_w = int(target_h * src_ratio)

    resized = img.resize((new_w, new_h), Image.LANCZOS)

    # 배경색: 원본 좌상단 픽셀 (민트 배경)
    bg_color = img.getpixel((10, 10))
    canvas = Image.new('RGB', (target_w, target_h), bg_color)
    x = (target_w - new_w) // 2
    y = (target_h - new_h) // 2
    canvas.paste(resized, (x, y))
    return canvas


def generate_sizes(input_path, output_dir):
    """모든 사이즈 생성"""
    img = Image.open(input_path).convert('RGB')
    basename = os.path.splitext(os.path.basename(input_path))[0]

    os.makedirs(output_dir, exist_ok=True)

    for name, (w, h, method) in SIZES.items():
        if method == '그대로':
            result = img.resize((w, h), Image.LANCZOS)
        elif method == '가로 크롭':
            result = crop_center(img, w, h)
        elif method == '비율 확대':
            result = fit_expand(img, w, h)
        elif method == '정사각 크롭':
            result = crop_center(img, w, h)

        out_path = os.path.join(output_dir, f"{basename}_{name}_{w}x{h}.png")
        result.save(out_path, 'PNG', quality=95)
        print(f"  {name:25s} {w}x{h}  -> {os.path.basename(out_path)}")

    print(f"\n  Done! {len(SIZES)} files in {output_dir}")


if __name__ == '__main__':
    input_file = sys.argv[1] if len(sys.argv) > 1 else 'Promo_01/output/promo_01_ko.png'
    input_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), input_file)
    output_dir = os.path.join(os.path.dirname(input_path), 'resized_ko')

    print(f"Input: {input_path}\n")
    generate_sizes(input_path, output_dir)
