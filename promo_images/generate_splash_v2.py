"""
Splash Screen v2 — Imagen 4로 재생성 (베트남/한국 국기 포함) + 하단 텍스트 오버레이
- 모델: imagen-4.0-generate-001 (사용자 선택)
- 비율: 9:16 세로
- 텍스트: PronunFit / a Smart Multi Languages Learning App with AI
"""

import os
from datetime import datetime
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
api_key = None
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("VITE_GEMINI_API_KEY="):
            api_key = line.split("=", 1)[1].strip()
            break
if not api_key:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("VITE_GEMINI_API_KEY")
if not api_key:
    raise SystemExit("GEMINI API key not found")

client = genai.Client(api_key=api_key)
SCRIPT_DIR = Path(__file__).resolve().parent

PROMPT = """
Create a tall vertical portrait image (9:16 aspect ratio) for a mobile app splash screen.

CRITICAL RULES:
- absolutely NO text, NO words, NO letters, NO numbers, NO characters of ANY language anywhere in the image
- NO phone mockups, NO device screens, NO UI elements
- realistic, clean, modern style — like a professional stock photo
- design natively for vertical 9:16 — do NOT crop a horizontal scene

SCENE:
A clean bright desk workspace photographed from a slightly elevated top-down angle,
composed vertically. Top half: warm light wood desk surface with items.
Bottom half: clean white marble surface — mostly empty, calm, perfect for a logo overlay.

Top half elements (on warm wood, distributed naturally):
- A small mint-green notebook with colored sticky tabs
- A small ceramic mint-green coffee cup with steam
- A small microphone icon pin

Middle area elements (transition zone, on marble):
- White earbuds with a curled white cable on the left
- 7 small round flag pin badges scattered as accents — these flags MUST be present:
  USA flag, South Korea flag (Taegukgi — white background with red and blue yin-yang circle and 4 black trigrams),
  Japan flag (white with red circle), China flag (red with yellow stars),
  France flag (blue/white/red vertical stripes), Spain flag (red/yellow/red horizontal with crest),
  Vietnam flag (red background with single yellow 5-pointed star in the center)
- A few colored pencils (mint, teal, yellow) resting diagonally

Bottom 40% of the image:
- CLEAN, EMPTY white marble surface — NO objects in the bottom area
- This empty space is intentional for logo overlay
- Subtle marble veining, soft shadow, natural daylight from upper left

Color palette:
- Dominant: warm light wood (top), soft white marble (bottom), mint green (#dcfce7) accents
- Pops of color from flag pins
- Bright, airy, well-lit (natural daylight)

Mood: professional, approachable, inviting, language-learning ready.
Like a stock flat-lay photo for an education brand.
REAL and TANGIBLE — not illustrated, not cartoonish, not AI-looking.

Portrait 9:16. NO TEXT anywhere in the image itself.
"""


def generate_imagen4(n=3):
    print(f"[imagen-4.0-generate-001] generating {n} candidates (9:16)")
    response = client.models.generate_images(
        model="imagen-4.0-generate-001",
        prompt=PROMPT,
        config=types.GenerateImagesConfig(
            number_of_images=n,
            aspect_ratio="9:16",
        ),
    )
    paths = []
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    for i, img in enumerate(response.generated_images):
        path = SCRIPT_DIR / f"splash_v2_imagen4_{i+1}_{ts}.png"
        path.write_bytes(img.image.image_bytes)
        print(f"  base saved: {path}")
        paths.append(path)
    return paths


def find_font(preferred_names, size):
    """Windows 기본 폰트에서 첫 매칭 선택"""
    win_fonts = Path("C:/Windows/Fonts")
    for name in preferred_names:
        p = win_fonts / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def overlay_text(base_path: Path) -> Path:
    """하단 마블 영역에 PronunFit + tagline 오버레이"""
    img = Image.open(base_path).convert("RGBA")
    W, H = img.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 폰트 크기는 이미지 폭 기준
    title_size = int(W * 0.11)   # 약 11%
    sub_size = int(W * 0.035)    # 약 3.5%

    title_font = find_font(
        ["segoeuib.ttf", "arialbd.ttf", "calibrib.ttf", "segoeui.ttf"],
        title_size,
    )
    sub_font = find_font(
        ["segoeui.ttf", "arial.ttf", "calibri.ttf"],
        sub_size,
    )

    title_text = "PronunFit"
    sub_text = "a Smart Multi Languages Learning App with AI"

    # 텍스트 박스 크기 측정
    t_bbox = draw.textbbox((0, 0), title_text, font=title_font)
    s_bbox = draw.textbbox((0, 0), sub_text, font=sub_font)
    t_w, t_h = t_bbox[2] - t_bbox[0], t_bbox[3] - t_bbox[1]
    s_w, s_h = s_bbox[2] - s_bbox[0], s_bbox[3] - s_bbox[1]

    # 배치: 하단 마블 영역 중앙 — 이미지 하단으로부터 약 18% 지점에 타이틀 baseline
    title_y = int(H * 0.78)
    sub_y = title_y + t_h + int(H * 0.012)
    title_x = (W - t_w) // 2
    sub_x = (W - s_w) // 2

    # 텍스트 그림자 (가독성)
    shadow_color = (0, 0, 0, 70)
    title_color = (15, 23, 42, 255)   # slate-900
    sub_color = (71, 85, 105, 255)    # slate-600

    # 그림자
    for dx, dy in [(2, 2), (-1, 1), (1, -1)]:
        draw.text((title_x + dx, title_y + dy), title_text, font=title_font, fill=shadow_color)
    draw.text((title_x, title_y), title_text, font=title_font, fill=title_color)
    draw.text((sub_x, sub_y), sub_text, font=sub_font, fill=sub_color)

    composed = Image.alpha_composite(img, overlay).convert("RGB")
    out_path = base_path.with_name(base_path.stem + "_text.png")
    composed.save(out_path, "PNG")
    print(f"  overlay saved: {out_path}")
    return out_path


if __name__ == "__main__":
    print("Splash v2 생성 + 텍스트 오버레이")
    bases = generate_imagen4(n=3)
    for b in bases:
        try:
            overlay_text(b)
        except Exception as e:
            print(f"  overlay failed for {b.name}: {e}")
    print("Done.")
