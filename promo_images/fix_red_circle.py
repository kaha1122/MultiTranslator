"""
splash_final_nano_2의 빈 빨간 원(태극기 옆) 제거 + 마블로 복원.
Nano Banana 2 (gemini-3.1-flash-image-preview)로 인페인팅.
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

client = genai.Client(api_key=api_key)
SCRIPT_DIR = Path(__file__).resolve().parent
SRC = SCRIPT_DIR / "splash_final_nano_2_20260418_153647.png"

PROMPT = """
You are given ONE image: a vertical 9:16 splash screen.

TASK:
In the flag-pin cluster area (middle of the image), there is ONE PLAIN RED CIRCLE badge
that has NO flag design on it (located to the right of the Korean flag, upper row of pins).
This is a visual defect — a flag badge that was left blank red.

REMOVE that plain red blank circle completely. Replace that area with the surrounding
white marble texture so it looks as if the blank badge was never there.

STRICT RULES:
- Do NOT touch any other element: keep all other flag pins (USA, Korea Taegukgi, Japan,
  China, France, Spain with crest, Vietnam with yellow star) exactly where they are.
- Do NOT touch the earbuds, colored pencils, notebook, coffee cup, or the "PronunFit" 3D
  logo and its subtitle at the bottom — all must remain pixel-identical.
- Only the blank red circle disappears, seamlessly blended into the marble.
- Preserve lighting, shadows, overall composition, and 9:16 aspect ratio.

Output: one corrected image.
"""


def run(n=3):
    if not SRC.exists():
        raise SystemExit(f"Source missing: {SRC}")
    base = Image.open(SRC).convert("RGB")
    print(f"src: {SRC.name} {base.size}")

    for i in range(1, n + 1):
        print(f"\n[attempt {i}/{n}]")
        try:
            response = client.models.generate_content(
                model="gemini-3.1-flash-image-preview",
                contents=[PROMPT, base],
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                ),
            )
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    out = SCRIPT_DIR / f"splash_final_fixed_{i}_{ts}.png"
                    out.write_bytes(part.inline_data.data)
                    print(f"  saved: {out}")
                elif getattr(part, "text", None):
                    print(f"  [text] {part.text[:160]}")
        except Exception as e:
            print(f"  failed: {type(e).__name__}: {e}")


if __name__ == "__main__":
    run(n=3)
    print("\nDone.")
