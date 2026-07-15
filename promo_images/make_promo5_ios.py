#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Promo_01 6개 언어 초안 생성 (그림1 스타일)
 - 새 폰 스크린샷(NewImages/Promo5/pro01_*.jpg) 사용
 - 배경: promo_01 연그린 톤 재현 / 헤더: 언어별 번역 / 폰: 상단 고정·하단 크롭
헤더 원문(ko): "레벨별 70가지 Topic, 3개국어 동시학습이 가능해요"
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

HERE = Path(__file__).resolve().parent
NEW = HERE / "NewImages/Promo5"
OUT = NEW / "out"; OUT.mkdir(exist_ok=True)
IOS_OUT = HERE / "NewImages/New_EachLanguage_ios"
BG_REF = HERE / "Promo_01/output/ko/promo_01_ko_1080x1920_BAK.png"
CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"   # idx: JP0 KR1 HK2 TC3 SC4
LATIN = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
W, Hc = 1242, 2688
INK = (31, 41, 37); MINT = (0, 168, 132)

# 배경 그라데이션(연그린 톤) 재현
ref = np.asarray(Image.open(BG_REF).convert("RGB")).astype(int)
_rows = np.median(ref[:, 8:40, :], axis=1)
_src = np.linspace(0, 1, _rows.shape[0]); _dst = np.linspace(0, 1, Hc)
BG_ROWS = np.stack([np.interp(_dst, _src, _rows[:, c]) for c in range(3)], axis=1).astype(np.uint8)

# 언어별: 파일, 2줄 헤더, 강조어, 폰트(종류, ttc인덱스)
LANGS = [
 ("kr", "ListeningSentence.jpg", ["AI가 무한 생성하는 듣기 지문", "공부하기 참 좋아요"], "무한 생성", ("cjk", 1)),
 ("en", "ListeningSentence.jpg", ["Endless AI-generated listening,", "perfect for studying"], "Endless", ("latin", 0)),
 ("cn", "ListeningSentence.jpg", ["AI无限生成的听力短文,", "学习起来真不错"], "无限生成", ("cjk", 4)),
 ("jp", "ListeningSentence.jpg", ["AIが無限に生成するリスニング", "学習にぴったりです"], "無限に生成", ("cjk", 0)),
 ("es", "ListeningSentence.jpg", ["Audios infinitos creados por IA,", "perfectos para estudiar"], "infinitos", ("latin", 0)),
 ("ru", "ListeningSentence.jpg", ["Бесконечные аудио от ИИ,", "идеально для учёбы"], "Бесконечные", ("latin", 0)),
 ("vn", "ListeningSentence.jpg", ["Bài nghe AI tạo vô hạn,", "rất hợp để học"], "vô hạn", ("latin", 0)),
]

def get_font(spec, size):
    kind, idx = spec
    if kind == "cjk":
        return ImageFont.truetype(CJK, size, index=idx)
    return ImageFont.truetype(LATIN, size)

def build(lang, fname, lines, hl, fspec):
    # 배경
    bg = np.repeat(BG_ROWS[:, None, :], W, axis=1)
    canvas = Image.fromarray(bg, "RGB").convert("RGBA")

    # 폰 프레임
    shot = Image.open(NEW / fname).convert("RGB")
    OW = 1080; B = 18; x = (W - OW) // 2; OT = 500   # 폰 상단 위치(빨간선 기준 살짝 올림)
    IW = OW - 2 * B
    f = IW / shot.width
    IH = int(shot.height * f)
    shot = shot.resize((IW, IH), Image.LANCZOS)
    Rin = 62; Rout = 80
    OH = IH + 2 * B

    phone = Image.new("RGBA", (OW, OH), (0, 0, 0, 0))
    ImageDraw.Draw(phone).rounded_rectangle([0, 0, OW, OH], radius=Rout, fill=(11, 18, 32, 255))
    smask = Image.new("L", (IW, IH), 0)
    ImageDraw.Draw(smask).rounded_rectangle([0, 0, IW, IH], radius=Rin, fill=255)
    phone.paste(shot, (B, B), smask)

    # 그림자
    shadow = Image.new("RGBA", (W, Hc), (0, 0, 0, 0))
    sd = Image.new("RGBA", (OW + 90, OH + 90), (0, 0, 0, 0))
    ImageDraw.Draw(sd).rounded_rectangle([45, 45, 45 + OW, 45 + OH], radius=Rout, fill=(10, 50, 40, 120))
    sd = sd.filter(ImageFilter.GaussianBlur(34))
    shadow.alpha_composite(sd, (x - 45, OT - 39))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(phone, (x, OT))   # 하단은 캔버스 밖으로 자동 크롭
    canvas = canvas.convert("RGB")

    # 헤더 (오토핏: 가장 긴 줄이 940px 안에 들도록)
    dr = ImageDraw.Draw(canvas)
    size = 78
    while size > 48:
        font = get_font(fspec, size)
        if max(dr.textlength(l, font=font) for l in lines) <= 1100:
            break
        size -= 2
    font = get_font(fspec, size)
    lh = int(size * 1.34)
    y = 180 if len(lines) <= 2 else 120

    def w(s): return dr.textlength(s, font=font)
    for line in lines:
        if hl and hl in line:
            a_, b_ = line.split(hl, 1)
            tw = w(a_) + w(hl) + w(b_)
            cur = (W - tw) / 2
            for seg, col in [(a_, INK), (hl, MINT), (b_, INK)]:
                dr.text((cur, y), seg, font=font, fill=col); cur += w(seg)
        else:
            dr.text(((W - w(line)) / 2, y), line, font=font, fill=INK)
        y += lh

    out = IOS_OUT / lang; out.mkdir(parents=True, exist_ok=True); out = out / f"promo_05_{lang}_1242x2688.png"
    canvas.save(out)
    return out


for lang, fn, lines, hl, fs in LANGS:
    print("OK", build(lang, fn, lines, hl, fs).name)
