"""
Vocab/Listening 7개 카테고리 슬라이드 카드 이미지 생성

- 모델: Gemini 3.1 Flash Image (Nano Banana 2) 우선, 실패 시 폴백 체인
- 비율: 1:1 (1024x1024) — 슬라이더 카드용 베이스, 앱에서 4:5로 크롭
- 텍스트: 이미지 자체에는 없음 (HTML/CSS 오버레이로 다국어 라벨 처리)
- 하단 1/3은 단순한 영역(하늘/벽/바닥)으로 — 텍스트 오버레이 가독성 확보

산출물: promo_images/category_cards/{cat_id}_v1.png
"""

import os
import sys
from datetime import datetime
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image
from io import BytesIO


# ── API 키 로드 (server/.env 우선, .env, 환경변수 순) ─────────────────
ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR / "category_cards"
OUT_DIR.mkdir(exist_ok=True)


def load_api_key():
    for env_path in [ROOT / "server" / ".env", ROOT / ".env"]:
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key in ("GEMINI_API_KEY", "VITE_GEMINI_API_KEY") and val:
                return val
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("VITE_GEMINI_API_KEY")


api_key = load_api_key()
if not api_key:
    raise SystemExit("GEMINI API key not found in server/.env, .env, or env vars")

client = genai.Client(api_key=api_key)


# ── 카테고리 정의 (7개) ──────────────────────────────────────────────
CATEGORIES = [
    {
        "id": "daily",
        "name": "Daily Life",
        "mood": "warm, intimate, slice-of-life",
        "setting": (
            "a sunlit modern apartment kitchen at golden hour — "
            "a kettle gently steaming on the stove, a cat curled on the windowsill, "
            "morning light streaming through sheer curtains"
        ),
        "palette": "cream, terracotta, soft amber, warm white",
        "topics": [
            "Morning Routine", "Cooking & Meals", "Cleaning & Organizing",
            "Grocery Shopping", "Weather & Seasons", "Cafe & Drinks",
            "Exercise & Health", "Hobbies & Interests", "Pets",
            "Fashion & Shopping",
        ],
    },
    {
        "id": "travel",
        "name": "Travel",
        "mood": "adventurous, restless, hopeful",
        "setting": (
            "an airport terminal at blue hour — a lone traveler with a backpack "
            "stands in front of floor-to-ceiling windows watching planes, "
            "a softly glowing departure board reflecting on the polished floor"
        ),
        "palette": "teal, indigo, deep navy, warm amber signage glow",
        "topics": [
            "Airport & Flight", "Train & Bus", "Taxi & Rental Car",
            "Asking Directions", "Immigration & Customs", "Hotel Check-in",
            "Tourist Spots", "Local Food", "Emergencies",
            "Culture & Etiquette",
        ],
    },
    {
        "id": "business",
        "name": "Business",
        "mood": "sharp, decisive, modern, ambitious",
        "setting": (
            "a glass-walled meeting room high above a city at night — "
            "a confident professional in a tailored suit stands mid-handshake "
            "across a single uninterrupted concrete-and-steel meeting table that fills the entire foreground "
            "and continues seamlessly into the bottom edge of the frame; "
            "city lights blurred to bokeh OUTSIDE the glass walls only, "
            "a laptop screen casts a cool blue glow on the table surface. "
            "IMPORTANT: ONE single continuous interior scene — the table surface flows uninterrupted "
            "from midground to the very bottom of the frame. Absolutely no second horizon line, "
            "no panoramic strip, no bokeh band, no separate landscape, no double-exposure effect "
            "anywhere in the lower half of the image."
        ),
        "palette": "charcoal, midnight navy, brushed gold accents, cool steel",
        "topics": [
            "Meetings", "Emails", "Phone & Video Calls",
            "Negotiation", "Networking", "Job Interview",
            "Resume & Cover Letter", "Salary & Benefits", "Teamwork",
            "Startup",
        ],
    },
    {
        "id": "education",
        "name": "Education",
        "mood": "thoughtful, aspirational, quiet, focused",
        "setting": (
            "a grand university library aisle bathed in shafts of warm afternoon sunlight — "
            "a student sits at a wooden desk surrounded by open books, an open notebook, "
            "headphones, a globe and a world map on the wall behind"
        ),
        "palette": "sepia, oak brown, paper white, soft dust-light gold",
        "topics": [
            "Classes & Homework", "Exams & Grades", "Campus Life",
            "Library & Research", "Language Learning", "Reading",
            "Online Courses", "Certifications", "Study Abroad",
            "Motivation",
        ],
    },
    {
        "id": "social",
        "name": "Social & Relations",
        "mood": "warm, candid, celebratory, joyful",
        "setting": (
            "a rooftop dinner party at dusk — string lights overhead, "
            "a long wooden table set with food and wine, "
            "a group of friends caught mid-laugh raising glasses, "
            "city skyline glowing pink and purple in the background"
        ),
        "palette": "rose-gold, magenta, twilight blue, candle amber",
        "topics": [
            "Greetings", "Opinions & Feelings", "Compliments & Thanks",
            "Apologies", "Humor", "Parties & Celebrations",
            "Weddings", "Dating & Romance", "Family Events",
            "Social Media",
        ],
    },
    {
        "id": "tech",
        "name": "Tech & IT",
        "mood": "sleek, futuristic, focused, electric",
        "setting": (
            "a dim startup studio at night — a developer at a multi-monitor workstation, "
            "translucent holographic UI projections floating above the desk, "
            "neural-network-style ambient particles drifting through the air, "
            "a single architectural lamp casting warm light"
        ),
        "palette": "deep blue, cyan, hot magenta accent, graphite black",
        "topics": [
            "Smartphones & Apps", "Computer & Software", "Internet",
            "AI & Chatbots", "Gaming", "E-commerce",
            "Fintech", "Biotech & Healthcare", "Energy & Environment",
            "Space & Robotics",
        ],
    },
    {
        "id": "culture",
        "name": "Culture & Arts",
        "mood": "majestic, lyrical, theatrical, reverent",
        "setting": (
            "the mezzanine of a grand opera house just before the curtain rises — "
            "a single spotlight falls on a velvet stage below, "
            "gilded balconies sweep around in tiers, "
            "a lone silhouetted figure in evening attire watches from the audience"
        ),
        "palette": "crimson velvet, rich gold, midnight black, warm spotlight ivory",
        "topics": [
            "Movies & TV Shows", "Music", "Books & Literature",
            "K-POP & Korean Wave", "Sports", "Festivals & Holidays",
            "Food Culture", "Art & Architecture", "Religion & Philosophy",
            "History",
        ],
    },
]


# ── 마스터 프롬프트 템플릿 ───────────────────────────────────────────
PROMPT_TEMPLATE = """\
A single cinematic film still — composed as one continuous scene (NOT a collage,
NOT a grid, NOT panels). Square 1:1 aspect ratio. Shot on 35mm film with subtle
grain, anamorphic lens character, shallow depth of field, soft volumetric
lighting, painterly hand-graded color, slight halation in highlights.

CRITICAL RULES:
- absolutely NO text, NO words, NO letters, NO numbers, NO captions, NO logos,
  NO watermarks, NO UI overlays, NO subtitles anywhere in the image
- ONE single scene only — no split-screens, no multiple panels, no photo collages,
  no double-exposure, no second horizon line, no panoramic strip stacked under
  the main scene; the lower half must be a continuous extension of the SAME
  physical space as the upper half
- photorealistic — looks like a still pulled from a high-end feature film
- output a perfect square 1:1 image at the highest resolution the model supports
  (target 1024x1024 minimum); do NOT crop down to a smaller letterboxed thumbnail
- the LOWER THIRD of the frame must be a relatively uniform low-complexity area
  belonging to the same scene (a polished floor, a quiet wall, a smooth table
  surface, a soft shadow, an open sky) so that a UI text label can sit cleanly
  on top later

CATEGORY: {name}
MOOD: {mood}
SETTING: {setting}
COLOR PALETTE: {palette}

The frame should evoke — but never literally enumerate or label — the following
life moments and themes (let them inform the props, wardrobe, atmosphere, and
emotional undertone, not appear as text):
{topics_block}

COMPOSITION:
- one human figure (or strongly implied human presence) placed on a golden-ratio
  intersection in the upper two-thirds of the frame
- shot from a slightly low cinematic angle for cinematic gravitas
- foreground / midground / background depth layering

OUTPUT: a single high-resolution 1:1 cinematic frame, photorealistic, NO TEXT.
"""


def build_prompt(cat: dict) -> str:
    topics_block = "\n".join(f"- {t}" for t in cat["topics"])
    return PROMPT_TEMPLATE.format(
        name=cat["name"],
        mood=cat["mood"],
        setting=cat["setting"],
        palette=cat["palette"],
        topics_block=topics_block,
    )


# ── Gemini Nano Banana 2 (3.x flash-image 계열) 생성 ─────────────────
CANDIDATE_MODELS = [
    "gemini-3.1-flash-image",
    "gemini-3-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-2.5-flash-image",
]


TARGET_SIZE = 1024


def _ensure_size(raw_bytes: bytes) -> bytes:
    """모델이 1024 미만으로 반환하면 LANCZOS 업스케일하여 1024x1024 보장."""
    img = Image.open(BytesIO(raw_bytes))
    if img.size == (TARGET_SIZE, TARGET_SIZE):
        return raw_bytes
    print(f"    upscaling {img.size} -> ({TARGET_SIZE},{TARGET_SIZE}) via LANCZOS")
    img = img.convert("RGB").resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def generate_one(cat: dict, attempt: int = 1) -> Path | None:
    prompt = build_prompt(cat)
    for model_id in CANDIDATE_MODELS:
        print(f"  [{cat['id']}] try model={model_id}")
        try:
            response = client.models.generate_content(
                model=model_id,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                    image_config=types.ImageConfig(aspect_ratio="1:1"),
                ),
            )
            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    suffix = f"_v{attempt}" if attempt > 1 else ""
                    out = OUT_DIR / f"{cat['id']}{suffix}.png"
                    safe_bytes = _ensure_size(part.inline_data.data)
                    out.write_bytes(safe_bytes)
                    print(f"    saved: {out.relative_to(ROOT)}")
                    return out
            print(f"    (no image in response)")
        except Exception as e:
            print(f"    failed: {type(e).__name__}: {e}")
    return None


def main():
    only = set(sys.argv[1:]) if len(sys.argv) > 1 else None
    print(f"Generating category card images → {OUT_DIR.relative_to(ROOT)}")
    print(f"  models tried in order: {CANDIDATE_MODELS}")
    if only:
        print(f"  filter: only category ids = {sorted(only)}")
    print()

    started = datetime.now()
    results = {}
    for cat in CATEGORIES:
        if only and cat["id"] not in only:
            continue
        print(f"[{cat['id']}] {cat['name']}")
        path = generate_one(cat)
        results[cat["id"]] = path
        print()

    elapsed = (datetime.now() - started).total_seconds()
    print(f"Done in {elapsed:.1f}s")
    print()
    print("Summary:")
    for cid, path in results.items():
        ok = "OK " if path else "FAIL"
        rel = path.relative_to(ROOT) if path else "-"
        print(f"  [{ok}] {cid:<10} {rel}")


if __name__ == "__main__":
    main()
