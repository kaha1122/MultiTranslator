"""
Play Store Feature Graphic (1024x500) 생성 - v2
소품 중앙 배치 + PronunFit 텍스트 포함
"""

import os
from datetime import datetime
from google import genai
from google.genai import types

API_KEY = "AIzaSyBhwh57eu1NCVJf_5UgMkAXJDvFOhCHQWU"
client = genai.Client(api_key=API_KEY)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

PROMPT = """
Create a WIDE HORIZONTAL image with 16:9 aspect ratio.

CRITICAL LAYOUT RULES:
- The image is VERY WIDE (16:9). Think of it as a cinema screen shape.
- ALL objects must be placed WITHIN the center 65% area of the image
- Leave at least 15% empty space on EVERY edge (top, bottom, left, right)
- NO object should touch or be cut off at ANY edge
- Every single item must be FULLY visible
- Items should be spread HORIZONTALLY across the wide center band

SCENE:
A realistic flat-lay photo taken from directly above a clean desk surface.
The composition is HORIZONTAL — items spread left to right in a single horizontal band.

LEFT SIDE (within safe area):
- A small mint-colored notebook with colorful tabs (fully visible)
- Small US flag pin and Japan flag pin nearby
- White earbuds coiled neatly

CENTER:
- The word "PronunFit" rendered as large 3D embossed raised letter logo in mint green (#00a884)
- The letters look like physical 3D objects on the desk, casting soft realistic shadows
- Bold, modern sans-serif font
- Below the PronunFit logo: "a Smart Multi Languages Learning App with AI" in smaller elegant dark gray text

RIGHT SIDE (within safe area):
- A coffee cup (top-down view) with mint-colored rim (fully visible)
- Small China and France flag pins
- A small silver desk microphone (fully visible)

ALL items arranged in a HORIZONTAL LINE across the middle of the image.
Top and bottom areas should be clean empty desk surface.

DESK SURFACE:
- Light warm wood grain texture
- Bright natural daylight, soft shadows

COLOR PALETTE:
- Dominant: mint green (#dcfce7), white, warm light wood
- Accent: teal (#00a884) for the logo

STYLE:
- Photorealistic flat-lay photography
- Professional product photography quality
- NOT illustrated, NOT cartoon, NOT fantasy

NO other text besides "PronunFit" and "a Smart Multi Languages Learning App with AI".
CRITICAL: Nothing cut off at edges. All items fully visible. Generous margins on all sides.
"""

def generate():
    print("🎨 Feature Graphic v2 생성 중...")

    # Gemini Flash
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
                path = os.path.join(SCRIPT_DIR, f"feature_v2_flash_{ts}.png")
                with open(path, "wb") as f:
                    f.write(part.inline_data.data)
                print(f"  ✅ 저장: {path}")
            elif part.text:
                print(f"  📝 {part.text[:100]}")
    except Exception as e:
        print(f"  ❌ 실패: {e}")

    # Imagen 4.0 (16:9)
    print("  [2] imagen-4.0-generate-001 (16:9)...")
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
            path = os.path.join(SCRIPT_DIR, f"feature_v3_imagen4_{i+1}_{ts}.png")
            with open(path, "wb") as f:
                f.write(img.image.image_bytes)
            print(f"  ✅ 저장: {path}")
    except Exception as e:
        print(f"  ❌ 실패: {e}")

    # 모든 v3 이미지를 1024x500으로 크롭
    print("  [3] 1024x500 크롭...")
    import glob
    from PIL import Image as PILImage
    for f in sorted(glob.glob(os.path.join(SCRIPT_DIR, "feature_v3_*.png"))):
        if '1024x500' in f:
            continue
        img = PILImage.open(f)
        tw, th = 1024, 500
        tr = tw / th
        sr = img.width / img.height
        if sr > tr:
            new_h = img.height
            new_w = int(new_h * tr)
            left = (img.width - new_w) // 2
            cropped = img.crop((left, 0, left + new_w, new_h))
        else:
            new_w = img.width
            new_h = int(new_w / tr)
            top = (img.height - new_h) // 2
            cropped = img.crop((0, top, new_w, top + new_h))
        result = cropped.resize((tw, th), PILImage.LANCZOS)
        out = f.replace('.png', '_1024x500.png')
        result.save(out, 'PNG')
        print(f"  ✅ {os.path.basename(out)} ({result.size})")

    print("\n🎉 완료!")


if __name__ == "__main__":
    generate()
