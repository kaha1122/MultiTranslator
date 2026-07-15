#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
promo_01_ko_1080x1920 단일 편집 (테스트):
 - 기존 배경 톤 유지(연그린 세로 그라데이션 재현)
 - 서브카피 + "이런 분께 딱" 체크리스트 + 푸터 제거
 - 헤더 카피만 새로 (그림1 스타일)
 - 폰: 비율로 줄여 맞추지 않고, 진짜 상단부터 온전히 보이게 한 뒤 아래만 캔버스 밖으로 잘림
 - 폰 스크린샷은 기존 이미지에서 추출(추후 사용자 제공 이미지로 교체)
"""
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

HERE = Path(__file__).resolve().parent
SRC = HERE / "Promo_01/output/ko/promo_01_ko_1080x1920.png"
BAK = SRC.with_name("promo_01_ko_1080x1920_BAK.png")
W, Hc = 1080, 1920
FONT_PATH = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

HEAD_LINES = ["AI와 함께 무료로,", "듣고 따라 말하며 공부해요"]
HL = "무료로"
INK = (31, 41, 37)
MINT = (0, 168, 132)

# 원본은 항상 백업본에서 읽는다(재실행 시 편집본 누적 방지)
if not BAK.exists():
    shutil.copy(SRC, BAK)
orig = Image.open(BAK).convert("RGB")
a = np.asarray(orig).astype(int)

# 1) 배경: 좌측 클린 컬럼에서 행별 색 추출 → 세로 그라데이션 재현
bg_rows = np.median(a[:, 8:40, :], axis=1).astype(np.uint8)
bg = np.repeat(bg_rows[:, None, :], W, axis=1)
canvas = Image.fromarray(bg, "RGB").convert("RGBA")

# 2) 폰 스크린샷 추출 — 기기 진짜 상단(둥근 베젤+상태바)부터 포함
PX0, PY0, PX1, PY1 = 297, 342, 783, 1410
phone = orig.crop((PX0, PY0, PX1, PY1))
pw, ph = phone.size
R_src = 40

# 3) 스케일: 상단 고정, 아래는 캔버스 밖으로 잘림
TARGET_W = 760
f = TARGET_W / pw
phone = phone.resize((TARGET_W, int(ph * f)), Image.LANCZOS)
PW, PH = phone.size
top = 360
x = (W - PW) // 2
R = int(R_src * f)

mask = Image.new("L", (PW, PH), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, PW, PH], radius=R, fill=255)

# 그림자
shadow = Image.new("RGBA", (W, Hc), (0, 0, 0, 0))
sd = Image.new("RGBA", (PW + 80, PH + 80), (0, 0, 0, 0))
ImageDraw.Draw(sd).rounded_rectangle([40, 40, 40 + PW, 40 + PH], radius=R, fill=(10, 50, 40, 110))
sd = sd.filter(ImageFilter.GaussianBlur(30))
shadow.alpha_composite(sd, (x - 40, top - 6))
canvas = Image.alpha_composite(canvas, shadow)

canvas.paste(phone, (x, top), mask)
canvas = canvas.convert("RGB")

# 5) 헤더 카피 (중앙 정렬, 강조어 민트)
dr = ImageDraw.Draw(canvas)
SIZE = 66
font = ImageFont.truetype(FONT_PATH, SIZE)

def line_width(s):
    return dr.textlength(s, font=font)

y = 140
for line in HEAD_LINES:
    if HL and HL in line:
        a_, b_ = line.split(HL, 1)
        tw = line_width(a_) + line_width(HL) + line_width(b_)
        cur = (W - tw) / 2
        for seg, col in [(a_, INK), (HL, MINT), (b_, INK)]:
            dr.text((cur, y), seg, font=font, fill=col)
            cur += line_width(seg)
    else:
        dr.text(((W - line_width(line)) / 2, y), line, font=font, fill=INK)
    y += int(SIZE * 1.32)

canvas.save(SRC)
print("saved", SRC)
