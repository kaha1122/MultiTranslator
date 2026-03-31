"""
방법A: AI 배경 생성 + 실제 스크린샷 합성 + Pillow 텍스트 오버레이
"""

import os
import sys
from datetime import datetime
from google import genai
from google.genai import types
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import io

API_KEY = "AIzaSyBhwh57eu1NCVJf_5UgMkAXJDvFOhCHQWU"
client = genai.Client(api_key=API_KEY)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCREENSHOT_PATH = os.path.join(SCRIPT_DIR, "app_screenshot.png")  # 사용자 제공 스크린샷
OUTPUT_DIR = SCRIPT_DIR

# ── 1단계: AI로 배경 이미지 생성 (텍스트 없이) ──
BG_PROMPT = """
Create a clean, modern promotional background image in portrait orientation (9:16 aspect ratio).

IMPORTANT: Do NOT include any text, words, letters, numbers, or characters of any language.
Do NOT include any phone mockup or device.

Design:
- Very light mint green gradient background, transitioning from pale mint (#f0fdf4) at top to slightly deeper mint (#dcfce7) at center and back to pale (#f0fdf4) at bottom
- Subtle decorative elements:
  - Soft circular bokeh-like glows in very light green (5-8% opacity)
  - A few thin geometric shapes (rounded rectangles, circles) as outlines in light mint green (8-10% opacity)
  - Very faint dot grid pattern across the background (3% opacity)
  - Small floating dots and ring shapes scattered sparsely
- The center area should be relatively clean/empty (this is where a phone mockup will be placed later)
- Overall feel: fresh, clean, professional, minimal, airy

Style: Flat design, no 3D effects, no gradients on shapes, very subtle and elegant.
Color palette: Only whites and mint/emerald greens (#f0fdf4, #dcfce7, #d1fae5, #a7f3d0, #6ee7b7, #00a884)
NO text anywhere. NO devices. Just a pure decorative background.
"""


def generate_background():
    """AI로 배경 이미지 생성"""
    print("🎨 배경 이미지 생성 중 (gemini-2.5-flash-image)...")

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=BG_PROMPT,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            )
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                bg_path = os.path.join(OUTPUT_DIR, "bg_generated.png")
                with open(bg_path, "wb") as f:
                    f.write(part.inline_data.data)
                print(f"  ✅ 배경 저장: {bg_path}")
                return bg_path
        print("  ⚠️ 이미지 없음")
        return None
    except Exception as e:
        print(f"  ❌ 실패: {e}")
        return None


def create_gradient_background(width, height):
    """Pillow로 그라데이션 배경 생성 (AI 실패 시 폴백)"""
    img = Image.new('RGB', (width, height))
    draw = ImageDraw.Draw(img)

    for y in range(height):
        ratio = y / height
        if ratio < 0.3:
            r, g, b = 240, 253, 244
        elif ratio < 0.6:
            t = (ratio - 0.3) / 0.3
            r = int(240 - t * 20)
            g = int(253 - t * 1)
            b = int(244 - t * 12)
        else:
            t = (ratio - 0.6) / 0.4
            r = int(220 + t * 20)
            g = int(252 + t * 1)
            b = int(232 + t * 12)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    return img


def get_font(size, weight='Regular'):
    """시스템 폰트 로드"""
    font_paths = [
        f"C:/Windows/Fonts/NotoSansKR-{weight}.ttf",
        f"C:/Windows/Fonts/NotoSansCJKkr-{weight}.otf",
        f"C:/Windows/Fonts/malgun.ttf",
        f"C:/Windows/Fonts/malgungbd.ttf",
    ]

    if weight in ('Bold', 'Black', 'ExtraBold'):
        font_paths.insert(0, "C:/Windows/Fonts/malgungbd.ttf")
    else:
        font_paths.insert(0, "C:/Windows/Fonts/malgun.ttf")

    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except:
                continue

    return ImageFont.load_default()


def composite_image(bg_path, screenshot_path):
    """배경 + 스크린샷 + 텍스트 합성"""
    W, H = 1080, 1920

    # 배경 로드 또는 생성
    if bg_path and os.path.exists(bg_path):
        bg = Image.open(bg_path).convert('RGB').resize((W, H), Image.LANCZOS)
        print("  📷 AI 배경 사용")
    else:
        bg = create_gradient_background(W, H)
        print("  🎨 Pillow 그라데이션 배경 사용")

    canvas = bg.copy()
    draw = ImageDraw.Draw(canvas)

    # ── 폰트 준비 ──
    font_title = get_font(56, 'Bold')
    font_title_highlight = get_font(56, 'Bold')
    font_sub = get_font(26, 'Regular')
    font_badge = get_font(20, 'Bold')
    font_callout = get_font(20, 'Bold')
    font_logo = get_font(36, 'Bold')

    # ── 상단 카피 ──
    # "당신이 직접 설계하는"
    line1 = "당신이 직접 설계하는"
    bbox1 = draw.textbbox((0, 0), line1, font=font_title)
    w1 = bbox1[2] - bbox1[0]
    draw.text(((W - w1) // 2, 95), line1, fill=(30, 41, 59), font=font_title)

    # "언어 학습의 혁명"
    part_a = "언어 학습의 "
    part_b = "혁명"
    bbox_a = draw.textbbox((0, 0), part_a, font=font_title)
    bbox_b = draw.textbbox((0, 0), part_b, font=font_title_highlight)
    wa = bbox_a[2] - bbox_a[0]
    wb = bbox_b[2] - bbox_b[0]
    total_w = wa + wb
    x_start = (W - total_w) // 2
    y2 = 170
    draw.text((x_start, y2), part_a, fill=(30, 41, 59), font=font_title)

    # "혁명" 하이라이트 배경
    hx = x_start + wa
    hbbox = draw.textbbox((hx, y2), part_b, font=font_title_highlight)
    draw.rounded_rectangle(
        [hx - 6, hbbox[3] - 16, hx + wb + 6, hbbox[3]],
        radius=4, fill=(0, 168, 132, 35)
    )
    draw.text((hx, y2), part_b, fill=(0, 168, 132), font=font_title_highlight)

    # 서브카피
    sub1 = "스스로 목표를 세우고 나아가는"
    sub2 = "진짜 학습자의 선택"
    bbox_s1 = draw.textbbox((0, 0), sub1, font=font_sub)
    bbox_s2 = draw.textbbox((0, 0), sub2, font=font_sub)
    draw.text(((W - (bbox_s1[2] - bbox_s1[0])) // 2, 260), sub1, fill=(100, 116, 139), font=font_sub)
    draw.text(((W - (bbox_s2[2] - bbox_s2[0])) // 2, 300), sub2, fill=(100, 116, 139), font=font_sub)

    # ── 폰 프레임 + 스크린샷 ──
    phone_w, phone_h = 440, 900
    phone_x = (W - phone_w) // 2
    phone_y = 370
    border_r = 44
    border_w = 4

    # 폰 그림자
    shadow = Image.new('RGBA', (phone_w + 40, phone_h + 40), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        [0, 0, phone_w + 39, phone_h + 39],
        radius=border_r + 4, fill=(0, 0, 0, 25)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=15))
    canvas.paste(Image.new('RGB', (phone_w + 40, phone_h + 40), canvas.getpixel((phone_x, phone_y))),
                 (phone_x - 20, phone_y + 5), shadow)

    # 폰 테두리
    draw.rounded_rectangle(
        [phone_x - border_w, phone_y - border_w,
         phone_x + phone_w + border_w, phone_y + phone_h + border_w],
        radius=border_r + border_w, fill=(209, 213, 219)
    )
    # 폰 내부 화이트
    draw.rounded_rectangle(
        [phone_x, phone_y, phone_x + phone_w, phone_y + phone_h],
        radius=border_r, fill=(255, 255, 255)
    )

    # 스크린샷 삽입
    if os.path.exists(screenshot_path):
        ss = Image.open(screenshot_path).convert('RGB')
        # 스크린샷을 폰 내부에 맞게 리사이즈 (상단 약간 크롭)
        inner_w = phone_w - 8
        inner_h = phone_h - 8
        ss_ratio = ss.width / ss.height
        inner_ratio = inner_w / inner_h

        if ss_ratio > inner_ratio:
            new_h = ss.height
            new_w = int(new_h * inner_ratio)
            left = (ss.width - new_w) // 2
            ss = ss.crop((left, 0, left + new_w, new_h))
        else:
            new_w = ss.width
            new_h = int(new_w / inner_ratio)
            ss = ss.crop((0, 0, new_w, new_h))

        ss = ss.resize((inner_w, inner_h), Image.LANCZOS)

        # 둥근 모서리 마스크
        mask = Image.new('L', (inner_w, inner_h), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([0, 0, inner_w - 1, inner_h - 1], radius=border_r - 4, fill=255)

        canvas.paste(ss, (phone_x + 4, phone_y + 4), mask)
        print("  📱 스크린샷 합성 완료")
    else:
        print(f"  ⚠️ 스크린샷 없음: {screenshot_path}")

    # ── 콜아웃 ──
    def draw_callout(cx, cy, text, side='left'):
        """콜아웃 뱃지 + 연결선 + 점 그리기"""
        badge_font = font_callout
        bbox = draw.textbbox((0, 0), text, font=badge_font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        pad_x, pad_y = 22, 10
        bw = tw + pad_x * 2
        bh = th + pad_y * 2
        line_len = 40

        if side == 'left':
            # 뱃지 왼쪽, 점 오른쪽 (폰 왼쪽 가장자리)
            dot_x = phone_x - 8
            dot_y = cy
            bx = dot_x - line_len - bw
            by = cy - bh // 2

            # 뱃지 배경
            draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2,
                                   fill=(255, 255, 255), outline=(0, 168, 132), width=2)
            draw.text((bx + pad_x, by + pad_y - 2), text, fill=(5, 150, 105), font=badge_font)

            # 연결선
            draw.line([(bx + bw, cy), (dot_x - 5, cy)], fill=(0, 168, 132, 120), width=2)

            # 점
            draw.ellipse([dot_x - 5, dot_y - 5, dot_x + 5, dot_y + 5], fill=(0, 168, 132))
            draw.ellipse([dot_x - 3, dot_y - 3, dot_x + 3, dot_y + 3], fill=(255, 255, 255))

        else:
            dot_x = phone_x + phone_w + 8
            dot_y = cy
            bx = dot_x + line_len
            by = cy - bh // 2

            draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2,
                                   fill=(255, 255, 255), outline=(0, 168, 132), width=2)
            draw.text((bx + pad_x, by + pad_y - 2), text, fill=(5, 150, 105), font=badge_font)

            draw.line([(dot_x + 5, cy), (bx, cy)], fill=(0, 168, 132, 120), width=2)

            draw.ellipse([dot_x - 5, dot_y - 5, dot_x + 5, dot_y + 5], fill=(0, 168, 132))
            draw.ellipse([dot_x - 3, dot_y - 3, dot_x + 3, dot_y + 3], fill=(255, 255, 255))

    # 콜아웃 위치 (폰 내부 UI 행 기준)
    # 스크린샷 기준: 언어Pills ≈ phone_y + 상단에서 약 18%, 난이도 ≈ 23%, 카테고리 ≈ 30%
    lang_y = phone_y + int(phone_h * 0.18)
    level_y = phone_y + int(phone_h * 0.23)
    topic_y = phone_y + int(phone_h * 0.31)

    draw_callout(0, lang_y, "내가 고르는 언어", 'left')
    draw_callout(0, level_y, "내가 정하는 난이도", 'right')
    draw_callout(0, topic_y, "내가 선택하는 주제", 'left')

    # ── 하단 피처 뱃지 ──
    badges = [
        ("🌐", "10개 언어"),
        ("📊", "3단계 난이도"),
        ("📂", "70개 주제"),
        ("🎯", "나만의 목표"),
    ]

    badge_y = 1750
    total_badge_w = 0
    badge_dims = []
    for icon, text in badges:
        full = f"{icon} {text}"
        bbox = draw.textbbox((0, 0), full, font=font_badge)
        tw = bbox[2] - bbox[0]
        badge_dims.append(tw + 32)
        total_badge_w += tw + 32

    gap = 12
    total_badge_w += gap * (len(badges) - 1)
    bx = (W - total_badge_w) // 2

    for i, (icon, text) in enumerate(badges):
        full = f"{icon} {text}"
        bw = badge_dims[i]
        bh = 40

        draw.rounded_rectangle([bx, badge_y, bx + bw, badge_y + bh], radius=14,
                               fill=(255, 255, 255), outline=(167, 243, 208), width=1)
        draw.text((bx + 16, badge_y + 8), full, fill=(51, 65, 85), font=font_badge)
        bx += bw + gap

    # 로고
    logo_text = "PronunFit"
    bbox_logo = draw.textbbox((0, 0), logo_text, font=font_logo)
    lw = bbox_logo[2] - bbox_logo[0]
    draw.text(((W - lw) // 2, 1820), logo_text, fill=(0, 168, 132), font=font_logo)

    # ── 저장 ──
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = os.path.join(OUTPUT_DIR, f"01_method_a_{timestamp}.png")
    canvas.save(output_path, 'PNG', quality=95)
    print(f"\n🎉 최종 이미지 저장: {output_path}")
    return output_path


if __name__ == "__main__":
    print("=" * 50)
    print("방법A: AI 배경 + 스크린샷 합성 + 텍스트 오버레이")
    print("=" * 50)

    # 스크린샷 파일 확인
    if not os.path.exists(SCREENSHOT_PATH):
        print(f"\n⚠️ 스크린샷 파일이 필요합니다: {SCREENSHOT_PATH}")
        print("   그림1의 Vocab 탭 스크린샷을 위 경로에 저장해주세요.")
        print("   스크린샷 없이 진행합니다...\n")

    # AI 배경 생성
    bg_path = generate_background()

    # 합성
    result = composite_image(bg_path, SCREENSHOT_PATH)
