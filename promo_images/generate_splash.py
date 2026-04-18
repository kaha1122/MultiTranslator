"""
Splash Screen 배경 이미지 생성 (세로 비율)
- 참조: feature_v3_imagen4_1_20260328_180115_1024x500.png (책상 풍경, 헤드폰, 국기, 민트그린)
- 모델: Gemini 3.1 Flash Image (Nano Banana 2)
- 용도: 앱 시작 시 스플래시 배경. 텍스트 없음.
"""

import os
from datetime import datetime
from pathlib import Path

from google import genai
from google.genai import types

# .env에서 API 키 로드 (프로젝트 루트)
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
    raise SystemExit("GEMINI API key not found in .env or env vars")

client = genai.Client(api_key=api_key)

SCRIPT_DIR = Path(__file__).resolve().parent

PROMPT = """
Create a tall vertical portrait image (9:16 aspect ratio) for a mobile app splash screen.

CRITICAL RULES:
- absolutely NO text, NO words, NO letters, NO numbers, NO characters of ANY language anywhere in the image
- NO phone mockups, NO device screens, NO UI elements
- realistic, clean, modern style — like a professional stock photo
- do NOT crop or squeeze the composition — design it natively for vertical 9:16

SCENE DESCRIPTION:
A clean, bright desk workspace scene photographed from a slightly elevated top-down angle,
composed vertically so the elements are spread naturally from top to bottom.
The scene should feel like a real stock photo of a language learning enthusiast's desk,
with a cohesive mint-green color theme.

Elements to include (arranged naturally on the surface, distributed vertically):
- A small notebook or flashcard stack with colored tabs
- White or mint-colored earbuds / small headphones with a curled cable
- A small ceramic coffee cup (mint green or white) with steam
- Tiny flag pins or round flag stickers scattered as accents (US, Japan, France, Spain, China — very small)
- A small desk microphone or microphone icon pin (suggesting pronunciation practice)
- A few colored pencils or a pen resting diagonally

Surface:
- Light wood grain OR white marble texture — clean and minimal
- Natural soft shadows, daylight lighting from the side

Color palette:
- Dominant: soft mint green (#dcfce7), white, warm light wood
- Accent: teal (#00a884), small pops of warm colors from flag elements
- Overall brightness: bright, airy, well-lit (natural daylight)
- The CENTER of the image should have slightly calmer / cleaner area so a logo can sit on top later

Mood: professional, approachable, inviting — suggests "ready to learn".
Like a well-composed flat-lay photo for an education brand.
The image should feel REAL and TANGIBLE, not illustrated, not cartoonish, not AI-looking.

Portrait 9:16 orientation. NO TEXT anywhere.
"""

CANDIDATE_MODELS = [
    "gemini-3.1-flash-image",
    "gemini-3-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-2.5-flash-image",
]


def try_gemini_image():
    """Gemini flash-image 계열 모델로 생성 시도 (3.1 우선, 실패 시 폴백)"""
    for model_id in CANDIDATE_MODELS:
        print(f"\n[try] model={model_id}")
        try:
            response = client.models.generate_content(
                model=model_id,
                contents=PROMPT,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                    image_config=types.ImageConfig(aspect_ratio="9:16"),
                ),
            )
            saved = []
            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                    safe_model = model_id.replace(".", "_")
                    path = SCRIPT_DIR / f"splash_{safe_model}_{ts}.png"
                    path.write_bytes(part.inline_data.data)
                    print(f"  saved: {path}")
                    saved.append(path)
            if saved:
                return saved
            print(f"  (no image in response)")
        except Exception as e:
            print(f"  failed: {type(e).__name__}: {e}")
    return []


def try_imagen_fallback():
    """Imagen-4로 폴백 (비교용)"""
    print("\n[fallback] imagen-4.0-generate-001 (9:16, 2장)")
    try:
        response = client.models.generate_images(
            model="imagen-4.0-generate-001",
            prompt=PROMPT,
            config=types.GenerateImagesConfig(
                number_of_images=2,
                aspect_ratio="9:16",
            ),
        )
        for i, img in enumerate(response.generated_images):
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            path = SCRIPT_DIR / f"splash_imagen4_{i+1}_{ts}.png"
            path.write_bytes(img.image.image_bytes)
            print(f"  saved: {path}")
    except Exception as e:
        print(f"  failed: {type(e).__name__}: {e}")


if __name__ == "__main__":
    print("Splash 이미지 생성 시작 (9:16 세로)")
    gemini_results = try_gemini_image()
    try_imagen_fallback()
    print("\nDone.")
