"""
Play Store Feature Graphic (1024x500) 생성
Gemini API로 텍스트 없는 배경 이미지 생성
"""

import os
from datetime import datetime
from google import genai
from google.genai import types

API_KEY = "AIzaSyBhwh57eu1NCVJf_5UgMkAXJDvFOhCHQWU"
client = genai.Client(api_key=API_KEY)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

PROMPT = """
Create a wide horizontal promotional banner image (landscape, 16:9 aspect ratio) for a language learning mobile app.

CRITICAL RULES:
- absolutely NO text, NO words, NO letters, NO numbers, NO characters of ANY language anywhere in the image
- NO phone mockups, NO device screens
- realistic, clean, modern style — NOT fantasy, NOT dreamy, NOT overly artistic
- professional marketing material quality

SCENE DESCRIPTION:
A clean, bright workspace scene photographed from a slightly elevated angle.
The scene should feel realistic like a stock photo but with a cohesive mint-green color theme.

Elements to include (arranged naturally on the surface):
- A few language learning related items: a small notebook or flashcard with colored tabs, earbuds/headphones (white or mint colored), a coffee cup
- Subtle hints of multilingual learning: small flag pins or stickers (US, Japan, China flags — very small, as accents)
- A microphone icon sticker or small desk mic (suggesting pronunciation practice)
- Clean, minimal desk surface — light wood or white marble texture

Color palette:
- Dominant: soft mint green (#dcfce7), white, light wood
- Accent: teal (#00a884), small pops of warm colors from flag elements
- Overall brightness: bright, airy, well-lit (natural daylight feel)
- The LEFT SIDE and RIGHT SIDE should have some empty/clean space (text will be overlaid later)

Mood: professional, approachable, studious but not boring.
Like a well-composed flat-lay photo for an education brand.
The image should feel REAL and TANGIBLE, not illustrated or AI-generated looking.

DO NOT include any text or writing on any surface in the image.
"""

def generate():
    print("🎨 Feature Graphic 배경 생성 중...")

    # gemini-2.5-flash-image
    print("  [1] gemini-2.5-flash-image...")
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=PROMPT,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            )
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                path = os.path.join(SCRIPT_DIR, f"feature_graphic_flash_{ts}.png")
                with open(path, "wb") as f:
                    f.write(part.inline_data.data)
                print(f"  ✅ 저장: {path}")
    except Exception as e:
        print(f"  ❌ 실패: {e}")

    # imagen-4.0
    print("  [2] imagen-4.0-generate-001...")
    try:
        response = client.models.generate_images(
            model="imagen-4.0-generate-001",
            prompt=PROMPT,
            config=types.GenerateImagesConfig(
                number_of_images=2,
                aspect_ratio="16:9",
            )
        )
        for i, img in enumerate(response.generated_images):
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            path = os.path.join(SCRIPT_DIR, f"feature_graphic_imagen4_{i+1}_{ts}.png")
            with open(path, "wb") as f:
                f.write(img.image.image_bytes)
            print(f"  ✅ 저장: {path}")
    except Exception as e:
        print(f"  ❌ 실패: {e}")

    print("\n🎉 완료! 생성된 이미지를 확인하세요.")
    print("   좋은 이미지를 골라서 Pillow로 텍스트 오버레이하면 됩니다.")


if __name__ == "__main__":
    generate()
