"""
PronunFit 플레이스토어 홍보 이미지 생성기
─────────────────────────────────────────
사용법:
  python promo_generator.py --screenshot 스크린샷.png --title "메인 카피" --subtitle "서브 카피" --output 결과.png

  또는 config로:
  python promo_generator.py --config 1

옵션:
  --screenshot   폰 안에 들어갈 앱 스크린샷 이미지 경로
  --title        상단 메인 카피 (줄바꿈: \\n)
  --highlight    메인 카피 중 강조할 단어
  --subtitle     서브 카피 (줄바꿈: \\n)
  --callouts     콜아웃 3개 (쉼표 구분, 위치:텍스트 형식)
                 예: "left:내가 고르는 언어,right:내가 정하는 난이도,left:내가 선택하는 주제"
  --callout-pos  콜아웃 Y위치 비율 3개 (쉼표 구분, 0.0~1.0)
                 예: "0.18,0.23,0.31"
  --badges       하단 뱃지 (쉼표 구분)
                 예: "🌐 10개 언어,📊 3단계 난이도,📂 70개 주제,🎯 나만의 목표"
  --output       출력 파일명
  --no-ai-bg     AI 배경 생성 건너뛰기 (Pillow 그라데이션 사용)
  --config       프리셋 번호 (1~5)
"""

import os
import sys
import argparse
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
W, H = 1080, 1920


# ══════════════════════════════════════════════
# 프리셋 설정 (5가지 홍보 이미지)
# ══════════════════════════════════════════════
PRESETS = {
    1: {
        "name": "자기 주도성",
        "screenshot": "app_screenshot.png",
        "title": "당신이 직접 설계하는\n언어 학습의 혁명",
        "highlight": "혁명",
        "subtitle": "스스로 목표를 세우고 나아가는\n진짜 학습자의 선택",
        "callouts": "left:내가 고르는 언어,right:내가 정하는 난이도,left:내가 선택하는 주제",
        "callout_pos": "0.18,0.23,0.31",
        "badges": "🌐 10개 언어,📊 3단계 난이도,📂 70개 주제,🎯 나만의 목표",
    },
    2: {
        "name": "다국어 동시 학습",
        "screenshot": "app_screenshot.png",
        "title": "하나를 배울 때\n셋을 얻는 압도적 효율",
        "highlight": "압도적 효율",
        "subtitle": "업계 유일의 3개 국어 동시 학습으로\n언어 간의 경계를 허무세요",
        "callouts": "",
        "callout_pos": "",
        "badges": "🇺🇸 English,🇯🇵 日本語,🇨🇳 中文,🇫🇷 Français,+6",
    },
    3: {
        "name": "초정밀 발음 교정",
        "screenshot": "app_screenshot.png",
        "title": "음소 단위까지 쪼개어\n완성하는 완벽 발음",
        "highlight": "완벽 발음",
        "subtitle": "AI가 당신의 목소리를 음절 단위로\n분석하여 짚어주는 디테일한 피드백",
        "callouts": "",
        "callout_pos": "",
        "badges": "🎯 정확도,🗣 유창성,🎵 운율감,🤖 AI 코치",
    },
    4: {
        "name": "무한 생성 커리큘럼",
        "screenshot": "app_screenshot.png",
        "title": "AI가 실시간으로 생성하는\n무한 커리큘럼",
        "highlight": "무한 커리큘럼",
        "subtitle": "70개 카테고리와 22가지 실전 상황\n당신의 레벨에 맞춰 끊임없이 업데이트",
        "callouts": "",
        "callout_pos": "",
        "badges": "📂 70개 주제,🎭 22개 상황,📊 3단계,♾️ 무한 생성",
    },
    5: {
        "name": "실속형 가성비",
        "screenshot": "app_screenshot.png",
        "title": "거품은 빼고 실력만 채운\n압도적 가성비",
        "highlight": "압도적 가성비",
        "subtitle": "타 앱 1개월 비용으로\n6개월의 가치를 경험하세요",
        "callouts": "",
        "callout_pos": "",
        "badges": "💰 월 $1.99,📱 10개 언어,🎙 무제한 발음,📚 무제한 카드",
    },
}


def get_font(size, bold=False):
    """시스템 한글 폰트 로드"""
    if bold:
        candidates = [
            "C:/Windows/Fonts/malgunbd.ttf",
            "C:/Windows/Fonts/malgungbd.ttf",
            "C:/Windows/Fonts/NotoSansKR-Bold.ttf",
        ]
    else:
        candidates = [
            "C:/Windows/Fonts/malgun.ttf",
            "C:/Windows/Fonts/NotoSansKR-Regular.ttf",
        ]
    for fp in candidates:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except:
                continue
    return ImageFont.load_default()


def create_gradient_bg():
    """밝은 민트 그라데이션 배경"""
    img = Image.new('RGB', (W, H))
    draw = ImageDraw.Draw(img)
    for y in range(H):
        ratio = y / H
        # 위: #f0fdf4 → 중간: #dcfce7 → 아래: #f0fdf4
        if ratio < 0.4:
            t = ratio / 0.4
            r = int(240 - t * 16)
            g = int(253 - t * 1)
            b = int(244 - t * 13)
        else:
            t = (ratio - 0.4) / 0.6
            r = int(224 + t * 16)
            g = int(252 + t * 1)
            b = int(231 + t * 13)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # 장식 원
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    circles = [
        (780, 80, 250, 12), (100, 900, 200, 8), (850, 1200, 150, 10),
        (200, 300, 80, 6), (900, 500, 60, 8),
    ]
    for cx, cy, radius, alpha in circles:
        od.ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
                   fill=(0, 168, 132, alpha))

    # 장식 링
    rings = [(120, 180, 40, 2), (920, 350, 25, 2), (80, 1400, 55, 1)]
    for cx, cy, radius, width in rings:
        od.ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
                   outline=(0, 168, 132, 20), width=width)

    # 도트 패턴
    for x in range(0, W, 30):
        for y in range(0, H, 30):
            od.ellipse([x, y, x + 1, y + 1], fill=(0, 168, 132, 8))

    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    return img


def generate_ai_bg():
    """Gemini API로 AI 배경 생성"""
    try:
        from google import genai
        from google.genai import types

        API_KEY = "AIzaSyBhwh57eu1NCVJf_5UgMkAXJDvFOhCHQWU"
        client = genai.Client(api_key=API_KEY)

        prompt = """Create a clean decorative background image, portrait 9:16 ratio.
NO text, NO words, NO letters, NO numbers, NO devices, NO phones.
Very light mint green gradient (#f0fdf4 to #dcfce7).
Subtle decorative elements: soft circular glows, thin geometric outlines,
faint dot grid, floating small circles. Center area should be clean/empty.
Style: minimal, fresh, airy. Colors: only white and mint greens."""

        response = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=prompt,
            config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                from io import BytesIO
                return Image.open(BytesIO(part.inline_data.data)).convert('RGB').resize((W, H), Image.LANCZOS)
        return None
    except Exception as e:
        print(f"  AI 배경 실패: {e}")
        return None


def draw_text_centered(draw, y, text, font, fill):
    """텍스트 중앙 정렬 그리기"""
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, fill=fill, font=font)
    return bbox[3] - bbox[1]


def generate_promo(screenshot_path, title, highlight, subtitle, callouts_str,
                   callout_pos_str, badges_str, output_path, use_ai_bg=True):
    """홍보 이미지 생성 메인 함수"""

    # ── 배경 ──
    if use_ai_bg:
        print("  🎨 AI 배경 생성 중...")
        canvas = generate_ai_bg()
        if canvas:
            print("  ✅ AI 배경 사용")
        else:
            print("  ⚠️ AI 실패, Pillow 배경 사용")
            canvas = create_gradient_bg()
    else:
        canvas = create_gradient_bg()
        print("  🎨 Pillow 배경 사용")

    draw = ImageDraw.Draw(canvas)

    # ── 폰트 ──
    f_title = get_font(56, bold=True)
    f_sub = get_font(25, bold=False)
    f_callout = get_font(21, bold=True)
    f_badge = get_font(19, bold=True)
    f_logo = get_font(36, bold=True)

    # ── 상단 카피 ──
    title_lines = title.split('\n')
    y_cursor = 90

    for line in title_lines:
        if highlight and highlight in line:
            # 강조 단어가 있는 줄: 분리 렌더링
            parts = line.split(highlight)
            before = parts[0]

            bbox_before = draw.textbbox((0, 0), before, font=f_title)
            bbox_hl = draw.textbbox((0, 0), highlight, font=f_title)
            after = parts[1] if len(parts) > 1 else ""
            bbox_after = draw.textbbox((0, 0), after, font=f_title)

            w_before = bbox_before[2] - bbox_before[0]
            w_hl = bbox_hl[2] - bbox_hl[0]
            w_after = bbox_after[2] - bbox_after[0]
            total = w_before + w_hl + w_after

            x = (W - total) // 2
            draw.text((x, y_cursor), before, fill=(30, 41, 59), font=f_title)

            hx = x + w_before
            # 하이라이트 밑줄
            h_bottom = y_cursor + (bbox_hl[3] - bbox_hl[1])
            draw.rounded_rectangle(
                [hx - 4, h_bottom - 14, hx + w_hl + 4, h_bottom + 2],
                radius=4, fill=(0, 168, 132, 35)
            )
            draw.text((hx, y_cursor), highlight, fill=(0, 168, 132), font=f_title)

            if after:
                draw.text((hx + w_hl, y_cursor), after, fill=(30, 41, 59), font=f_title)
        else:
            draw_text_centered(draw, y_cursor, line, f_title, (30, 41, 59))

        y_cursor += 78

    # 서브카피
    y_cursor += 10
    for sub_line in subtitle.split('\n'):
        draw_text_centered(draw, y_cursor, sub_line, f_sub, (100, 116, 139))
        y_cursor += 40

    # ── 폰 프레임 + 스크린샷 ──
    phone_w, phone_h = 440, 880
    phone_x = (W - phone_w) // 2
    phone_y = max(y_cursor + 40, 380)  # 카피 아래 충분한 간격 보장
    border_r = 46
    border = 4

    # 그림자 (정중앙, 균등)
    shadow_img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow_img)
    s_draw.rounded_rectangle(
        [phone_x - 6, phone_y + 6, phone_x + phone_w + 6, phone_y + phone_h + 12],
        radius=border_r + 4, fill=(0, 0, 0, 20)
    )
    shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(radius=16))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), shadow_img).convert('RGB')
    draw = ImageDraw.Draw(canvas)

    # 테두리
    draw.rounded_rectangle(
        [phone_x - border, phone_y - border,
         phone_x + phone_w + border, phone_y + phone_h + border],
        radius=border_r + border, fill=(209, 213, 219)
    )
    draw.rounded_rectangle(
        [phone_x, phone_y, phone_x + phone_w, phone_y + phone_h],
        radius=border_r, fill=(255, 255, 255)
    )

    # 스크린샷 삽입
    ss_path = os.path.join(SCRIPT_DIR, screenshot_path) if not os.path.isabs(screenshot_path) else screenshot_path
    if os.path.exists(ss_path):
        ss = Image.open(ss_path).convert('RGB')
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

        mask = Image.new('L', (inner_w, inner_h), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, inner_w - 1, inner_h - 1], radius=border_r - 4, fill=255)

        canvas.paste(ss, (phone_x + 4, phone_y + 4), mask)
        print(f"  📱 스크린샷 합성: {ss_path}")
    else:
        print(f"  ⚠️ 스크린샷 없음: {ss_path}")

    draw = ImageDraw.Draw(canvas)

    # ── 콜아웃 ──
    if callouts_str:
        callouts = []
        for c in callouts_str.split(','):
            c = c.strip()
            if ':' in c:
                side, text = c.split(':', 1)
                callouts.append((side.strip(), text.strip()))

        positions = [float(p.strip()) for p in callout_pos_str.split(',')] if callout_pos_str else []

        for i, (side, text) in enumerate(callouts):
            ratio = positions[i] if i < len(positions) else 0.2 + i * 0.08
            cy = phone_y + int(phone_h * ratio)

            bbox = draw.textbbox((0, 0), text, font=f_callout)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            pad_x, pad_y = 20, 10
            bw = tw + pad_x * 2
            bh = th + pad_y * 2
            line_len = 35

            if side == 'left':
                dot_x = phone_x - 6
                bx = dot_x - line_len - bw
                by = cy - bh // 2

                draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2,
                                       fill=(255, 255, 255), outline=(0, 168, 132), width=2)
                draw.text((bx + pad_x, by + pad_y - 1), text, fill=(5, 150, 105), font=f_callout)
                draw.line([(bx + bw, cy), (dot_x - 4, cy)], fill=(0, 168, 132), width=2)
                draw.ellipse([dot_x - 5, cy - 5, dot_x + 5, cy + 5], fill=(0, 168, 132))
                draw.ellipse([dot_x - 3, cy - 3, dot_x + 3, cy + 3], fill=(255, 255, 255))
            else:
                dot_x = phone_x + phone_w + 6
                bx = dot_x + line_len
                by = cy - bh // 2

                draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2,
                                       fill=(255, 255, 255), outline=(0, 168, 132), width=2)
                draw.text((bx + pad_x, by + pad_y - 1), text, fill=(5, 150, 105), font=f_callout)
                draw.line([(dot_x + 4, cy), (bx, cy)], fill=(0, 168, 132), width=2)
                draw.ellipse([dot_x - 5, cy - 5, dot_x + 5, cy + 5], fill=(0, 168, 132))
                draw.ellipse([dot_x - 3, cy - 3, dot_x + 3, cy + 3], fill=(255, 255, 255))

    # ── 하단 뱃지 ──
    if badges_str:
        badges = [b.strip() for b in badges_str.split(',')]
        badge_y = H - 160
        badge_dims = []
        for b in badges:
            bbox = draw.textbbox((0, 0), b, font=f_badge)
            badge_dims.append(bbox[2] - bbox[0] + 32)

        gap = 10
        total_w = sum(badge_dims) + gap * (len(badges) - 1)
        bx = (W - total_w) // 2

        for i, b in enumerate(badges):
            bw = badge_dims[i]
            draw.rounded_rectangle([bx, badge_y, bx + bw, badge_y + 38],
                                   radius=12, fill=(255, 255, 255), outline=(167, 243, 208), width=1)
            draw.text((bx + 16, badge_y + 7), b, fill=(51, 65, 85), font=f_badge)
            bx += bw + gap

    # 로고
    logo = "PronunFit"
    bbox_l = draw.textbbox((0, 0), logo, font=f_logo)
    lw = bbox_l[2] - bbox_l[0]
    draw.text(((W - lw) // 2, H - 95), logo, fill=(0, 168, 132), font=f_logo)

    # ── 저장 ──
    out = os.path.join(SCRIPT_DIR, output_path)
    canvas.save(out, 'PNG', quality=95)
    print(f"\n  🎉 저장 완료: {out}")
    return out


def main():
    parser = argparse.ArgumentParser(description='PronunFit 홍보 이미지 생성기')
    parser.add_argument('--config', type=int, help='프리셋 번호 (1~5)')
    parser.add_argument('--screenshot', type=str, help='스크린샷 파일 경로')
    parser.add_argument('--title', type=str, help='메인 카피')
    parser.add_argument('--highlight', type=str, default='', help='강조 단어')
    parser.add_argument('--subtitle', type=str, help='서브 카피')
    parser.add_argument('--callouts', type=str, default='', help='콜아웃')
    parser.add_argument('--callout-pos', type=str, default='', help='콜아웃 Y비율')
    parser.add_argument('--badges', type=str, default='', help='하단 뱃지')
    parser.add_argument('--output', type=str, default='', help='출력 파일명')
    parser.add_argument('--no-ai-bg', action='store_true', help='AI 배경 건너뛰기')

    args = parser.parse_args()

    if args.config:
        if args.config not in PRESETS:
            print(f"❌ 프리셋 {args.config} 없음 (1~5)")
            sys.exit(1)

        preset = PRESETS[args.config]
        print(f"═══ [{args.config}] {preset['name']} ═══")

        generate_promo(
            screenshot_path=args.screenshot or preset['screenshot'],
            title=args.title.replace('\\n', '\n') if args.title else preset['title'],
            highlight=args.highlight if args.highlight is not None else preset['highlight'],
            subtitle=(args.subtitle.replace('\\n', '\n') if args.subtitle else preset['subtitle']),
            callouts_str=args.callouts if args.callouts is not None else preset.get('callouts', ''),
            callout_pos_str=getattr(args, 'callout_pos', None) or preset.get('callout_pos', ''),
            badges_str=args.badges if args.badges else preset['badges'],
            output_path=args.output or f"promo_{args.config:02d}_{preset['name']}.png",
            use_ai_bg=not args.no_ai_bg,
        )
    else:
        if not args.title or not args.screenshot:
            print("❌ --title, --screenshot 필수 (또는 --config 사용)")
            parser.print_help()
            sys.exit(1)

        generate_promo(
            screenshot_path=args.screenshot,
            title=args.title.replace('\\n', '\n'),
            highlight=args.highlight,
            subtitle=(args.subtitle or '').replace('\\n', '\n'),
            callouts_str=args.callouts,
            callout_pos_str=args.callout_pos,
            badges_str=args.badges,
            output_path=args.output or f"promo_custom_{datetime.now():%Y%m%d_%H%M%S}.png",
            use_ai_bg=not args.no_ai_bg,
        )


if __name__ == '__main__':
    main()
