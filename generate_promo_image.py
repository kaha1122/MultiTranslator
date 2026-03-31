"""
PronunFit 플레이스토어 홍보 이미지 생성 스크립트
Gemini API (Imagen 3) 사용
"""

import os
import sys
import base64
from datetime import datetime
from google import genai
from google.genai import types

API_KEY = "AIzaSyBhwh57eu1NCVJf_5UgMkAXJDvFOhCHQWU"

client = genai.Client(api_key=API_KEY)

# ── 1번: 자기 주도성 ──────────────────────────────────────────────
PROMPT_1_SELF_DIRECTED = """
Create a premium Google Play Store promotional screenshot image in portrait orientation (1080x1920 pixels).

THEME: "Self-Directed Language Learning Revolution"

BACKGROUND:
- Deep dark navy (#0f172a) base
- A large radial gradient glow of mint green (#00a884) at 15% opacity emanating from the center
- Faint blueprint-style thin dotted grid lines across the entire background (white, 5% opacity) to evoke "designing your own learning path"
- A few small decorative floating rings and dots in mint green scattered sparsely

TOP AREA (upper 28%):
- Main headline text in bold white sans-serif font, centered:
  Line 1: "당신이 직접 설계하는" (in white)
  Line 2: "언어 학습의 혁명" (the word "혁명" in bright mint green #00a884, rest in white)
- Below: smaller subtext in light mint (#6ee7b7):
  "스스로 목표를 세우고 나아가는 진짜 학습자의 선택"

CENTER AREA (middle 47%):
- One realistic modern smartphone mockup, centered, with a very slight rightward tilt (2-3°)
- Floating with a soft mint-green ambient glow shadow beneath it
- The phone screen displays a clean language learning app interface:
  • Top horizontal row of language pill buttons: "English" (highlighted green), "日本語", "中文", "Français", "Deutsch" — small rounded pills
  • Three difficulty level buttons in a row: "초급", "중급" (selected, green background), "고급"
  • A category selector card showing: "일상생활 › 아침 루틴"
  • A bright green button with sparkle icon labeled "단어 생성"
  • Below: a vocabulary card with a Korean word, its meaning, and an example sentence

- Three thin white annotation lines (1px) extending outward from the phone to callout labels:
  • Left side from language pills: small rounded mint pill badge with text "내가 고르는 언어"
  • Right side from difficulty buttons: small rounded mint pill badge with text "내가 정하는 난이도"
  • Left side from category: small rounded mint pill badge with text "내가 선택하는 주제"
  Each line has a small dot at its connection point on the phone edge.

BOTTOM AREA (lower 25%):
- Four feature badges arranged in a 2×2 grid, centered
- Each badge: rounded rectangle with semi-transparent white background (rgba 255,255,255,0.07), subtle white border
  • Top-left: "🌐 10개 언어"
  • Top-right: "📊 3단계 난이도"
  • Bottom-left: "📂 70개 주제"
  • Bottom-right: "🎯 나만의 목표"
- Text in white, clean small font

- Very bottom center: "PronunFit" logo text in mint green (#00a884), bold stylized font

STYLE:
- Premium dark-mode aesthetic, modern and sleek
- Clean Korean sans-serif typography
- Subtle glassmorphism on card elements
- No photographs, no people, no hands, no realistic photos
- Professional mobile app marketing material
- High resolution, crisp, polished
- The overall feel should communicate empowerment and freedom of choice
"""

def generate_image(prompt, filename_prefix):
    """Gemini 이미지 생성 및 저장"""
    saved_files = []

    # 방법 1: Gemini 2.5 Flash Image 모델
    print("🎨 [1/3] gemini-2.5-flash-image 모델로 생성 중...")
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            )
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                ext = part.inline_data.mime_type.split("/")[-1]
                filename = f"promo_{filename_prefix}_flash_{timestamp}.{ext}"
                filepath = os.path.join("promo_images", filename)
                os.makedirs("promo_images", exist_ok=True)
                with open(filepath, "wb") as f:
                    f.write(part.inline_data.data)
                print(f"  ✅ 저장: {filepath}")
                saved_files.append(filepath)
            elif part.text is not None:
                print(f"  📝 텍스트: {part.text[:150]}")
    except Exception as e:
        print(f"  ❌ 실패: {e}")

    # 방법 2: Imagen 4.0
    print("🎨 [2/3] imagen-4.0-generate-001 모델로 생성 중...")
    try:
        response = client.models.generate_images(
            model="imagen-4.0-generate-001",
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="9:16",
            )
        )
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"promo_{filename_prefix}_imagen4_{timestamp}.png"
        filepath = os.path.join("promo_images", filename)
        os.makedirs("promo_images", exist_ok=True)
        image = response.generated_images[0]
        with open(filepath, "wb") as f:
            f.write(image.image.image_bytes)
        print(f"  ✅ 저장: {filepath}")
        saved_files.append(filepath)
    except Exception as e:
        print(f"  ❌ 실패: {e}")

    # 방법 3: Imagen 4.0 Fast
    print("🎨 [3/3] imagen-4.0-fast-generate-001 모델로 생성 중...")
    try:
        response = client.models.generate_images(
            model="imagen-4.0-fast-generate-001",
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="9:16",
            )
        )
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"promo_{filename_prefix}_imagen4fast_{timestamp}.png"
        filepath = os.path.join("promo_images", filename)
        os.makedirs("promo_images", exist_ok=True)
        image = response.generated_images[0]
        with open(filepath, "wb") as f:
            f.write(image.image.image_bytes)
        print(f"  ✅ 저장: {filepath}")
        saved_files.append(filepath)
    except Exception as e:
        print(f"  ❌ 실패: {e}")

    return saved_files


if __name__ == "__main__":
    print("=" * 50)
    print("PronunFit 홍보 이미지 생성기")
    print("=" * 50)
    print()

    result = generate_image(PROMPT_1_SELF_DIRECTED, "01_self_directed")

    if result:
        print(f"\n🎉 완료! 생성된 파일 {len(result)}개:")
        for f in result:
            print(f"   - {f}")
    else:
        print("\n💡 이미지 생성에 실패했습니다.")
        print("   Gemini API 키가 이미지 생성을 지원하는지 확인하세요.")
