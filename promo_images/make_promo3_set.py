#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Promo_01 6개 언어 초안 생성 (그림1 스타일)
 - 새 폰 스크린샷(NewImages/Promo3/pro01_*.jpg) 사용
 - 배경: promo_01 연그린 톤 재현 / 헤더: 언어별 번역 / 폰: 상단 고정·하단 크롭
헤더 원문(ko): "레벨별 70가지 Topic, 3개국어 동시학습이 가능해요"
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

HERE = Path(__file__).resolve().parent
NEW = HERE / "NewImages/Promo3"
OUT = NEW / "out"; OUT.mkdir(exist_ok=True)
BG_REF = HERE / "Promo_01/output/ko/promo_01_ko_1080x1920_BAK.png"
CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"   # idx: JP0 KR1 HK2 TC3 SC4
LATIN = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
W, Hc = 1080, 1920
INK = (31, 41, 37); MINT = (0, 168, 132)

# 배경 그라데이션(연그린 톤) 재현
ref = np.asarray(Image.open(BG_REF).convert("RGB")).astype(int)
BG_ROWS = np.median(ref[:, 8:40, :], axis=1).astype(np.uint8)

# 언어별: 파일, 2줄 헤더, 강조어, 폰트(종류, ttc인덱스)
LANGS = [
 ("kr", "pr03_kr.jpg", ["38개국 언어 학습이", "준비되어 있어요"], "38개국 언어", ("cjk", 1)),
 ("en", "pr03_en.jpg", ["38 languages ready", "for you to learn"], "38 languages", ("latin", 0)),
 ("cn", "pr03_cn.jpg", ["38种语言学习", "已为你准备就绪"], "38种语言", ("cjk", 4)),
 ("jp", "pr03_jp.jpg", ["38か国語の学習が", "用意されています"], "38か国語", ("cjk", 0)),
 ("es", "pr03_es.jpg", ["Aprende en 38 idiomas,", "todo listo para ti"], "38 idiomas", ("latin", 0)),
 ("ru", "pr03_ru.jpg", ["Обучение на 38 языках", "уже готово для вас"], "38 языках", ("latin", 0)),
 ("vn", "pr03_vn.jpg", ["Học bằng 38 ngôn ngữ", "đã sẵn sàng cho bạn"], "38 ngôn ngữ", ("latin", 0)),
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
    OW = 800; B = 16; x = (W - OW) // 2; OT = 425   # 폰 상단 위치(빨간선 기준 살짝 올림)
    IW = OW - 2 * B
    f = IW / shot.width
    IH = int(shot.height * f)
    shot = shot.resize((IW, IH), Image.LANCZOS)
    Rin = 54; Rout = 70
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
    size = 66
    while size > 40:
        font = get_font(fspec, size)
        if max(dr.textlength(l, font=font) for l in lines) <= 940:
            break
        size -= 2
    font = get_font(fspec, size)
    lh = int(size * 1.34)
    y = 140 if len(lines) <= 2 else 100

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

    out = OUT / f"promo_03_{lang}_1080x1920.png"
    canvas.save(out)
    return out


for lang, fn, lines, hl, fs in LANGS:
    print("OK", build(lang, fn, lines, hl, fs).name)
