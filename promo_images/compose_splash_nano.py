"""
Splash 합성 — Nano Banana 2 (gemini-3.1-flash-image-preview)
입력 1: 스플래시 베이스 (splash_v2_imagen4_3 — 텍스트 없는 imagen4 결과)
입력 2: 로고 참조 (feature_v3_imagen4_1 — 3D 민트그린 PronunFit + 서브텍스트)
목표: 베이스 이미지의 하단 마블 영역에, 참조의 PronunFit 로고를 색상·입체감 유지하면서 배치
"""

import os
from datetime import datetime
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image

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

BASE_IMG = SCRIPT_DIR / "splash_v2_imagen4_3_20260418_153013.png"
LOGO_REF = SCRIPT_DIR / "feature_v3_imagen4_1_20260328_180115_1024x500.png"

PROMPT = """
You are given TWO images:
- IMAGE 1 is the BASE splash screen background (vertical 9:16, warm wood desk on top with small mint notebook/coffee/earbuds/flag pins, clean white marble surface on the bottom half — intentionally empty for a logo).
- IMAGE 2 is a LOGO REFERENCE that contains the exact "PronunFit" 3D logo text (soft mint-green color, chunky rounded 3D letters with depth and cast shadow) and a subtitle "A Smart Multi Languages Learning App with AI".

TASK:
Compose a SINGLE new image that keeps IMAGE 1 exactly as it is (desk scene, flags, marble, lighting all unchanged) — and ONLY adds the "PronunFit" 3D logo + subtitle from IMAGE 2 onto the clean lower marble area of IMAGE 1.

STRICT RULES FOR THE LOGO PLACEMENT:
- Preserve the EXACT style of "PronunFit" from IMAGE 2: same mint-green color (#7FD1B9-ish soft teal-green), same chunky rounded 3D letterforms, same depth/extrusion, same cast shadow, same glossy surface feel.
- Do NOT change the spelling. Exact text: "PronunFit"
- Below the logo, render the subtitle exactly: "A Smart Multi Languages Learning App with AI"
- Subtitle style: clean modern sans-serif, dark slate gray, much smaller than the logo, centered under it.
- Horizontally CENTER the logo + subtitle on the marble area.
- Vertical position: place the logo so the whole block (logo + subtitle) sits nicely in the lower 40% of the image with comfortable breathing room — not touching the bottom edge, not overlapping with the earbuds/flags/pencils above.
- SIZE: the "PronunFit" logo should span roughly 70–80% of the image width — prominent but not cramped.
- Lighting: match the soft daylight in the base scene; the 3D logo should cast a faint natural shadow on the marble.

DO NOT:
- do NOT add or move any object in the base scene (no new flags, no extra items, no cropping).
- do NOT change the color palette of the base.
- do NOT add any other text besides "PronunFit" and the exact subtitle.
- do NOT include letters from other languages.

Output: one final vertical 9:16 composited image only.
"""


def load_image(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def compose(n=3):
    if not BASE_IMG.exists():
        raise SystemExit(f"Base image missing: {BASE_IMG}")
    if not LOGO_REF.exists():
        raise SystemExit(f"Logo reference missing: {LOGO_REF}")

    base = load_image(BASE_IMG)
    logo_ref = load_image(LOGO_REF)
    print(f"base:  {BASE_IMG.name}  {base.size}")
    print(f"logo:  {LOGO_REF.name}  {logo_ref.size}")

    for attempt in range(1, n + 1):
        print(f"\n[attempt {attempt}/{n}] gemini-3.1-flash-image-preview")
        try:
            response = client.models.generate_content(
                model="gemini-3.1-flash-image-preview",
                contents=[PROMPT, base, logo_ref],
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                ),
            )
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            got = False
            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    out = SCRIPT_DIR / f"splash_final_nano_{attempt}_{ts}.png"
                    out.write_bytes(part.inline_data.data)
                    print(f"  saved: {out}")
                    got = True
                elif getattr(part, "text", None):
                    print(f"  [model text] {part.text[:160]}")
            if not got:
                print("  (no image in response)")
        except Exception as e:
            print(f"  failed: {type(e).__name__}: {e}")


if __name__ == "__main__":
    print("Splash 합성 시작 (Nano Banana 2, 두 이미지 입력)")
    compose(n=3)
    print("\nDone.")
