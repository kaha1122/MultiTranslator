#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Promo_02 7개 언어 (그림1 스타일) — 화면 중앙 "직접입력(自定义输入)" 라벨+회색 입력박스를
색으로 자동 감지해 잘라내고 상/하단을 이어붙여, 하단 발음 평가(점수 원형)가 보이도록 처리.
나머지(상단 고정·하단 크롭·프레임·배경)는 Promo_01과 동일.
헤더 원문(ko): "당신의 발음을 AI가 음소단위까지 분석해요"
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

HERE = Path(__file__).resolve().parent
NEW = HERE / "NewImages/Promo2"
OUT = NEW / "out"; OUT.mkdir(exist_ok=True)
IOS_OUT = HERE / "NewImages/New_EachLanguage_ios"
BG_REF = HERE / "Promo_01/output/ko/promo_01_ko_1080x1920_BAK.png"
CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"   # JP0 KR1 HK2 TC3 SC4
LATIN = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
W, Hc = 1242, 2688
INK = (31, 41, 37); MINT = (0, 168, 132)

ref = np.asarray(Image.open(BG_REF).convert("RGB")).astype(int)
_rows = np.median(ref[:, 8:40, :], axis=1)
_src = np.linspace(0, 1, _rows.shape[0]); _dst = np.linspace(0, 1, Hc)
BG_ROWS = np.stack([np.interp(_dst, _src, _rows[:, c]) for c in range(3)], axis=1).astype(np.uint8)

LANGS = [
 ("kr", "pro_kr.jpg",  ["당신의 발음을 AI가", "음소 단위까지 분석해요"], "음소 단위까지", ("cjk", 1)),
 ("en", "pro2_en.jpg", ["AI analyzes your pronunciation", "down to the phoneme"], "down to the phoneme", ("latin", 0)),
 ("cn", "pro02_cn.jpg",["AI 将你的发音", "精确分析到音素级别"], "音素级别", ("cjk", 4)),
 ("jp", "pro02_jp.jpg",["あなたの発音をAIが", "音素単位まで分析します"], "音素単位まで", ("cjk", 0)),
 ("es", "pro02_es.jpg",["La IA analiza tu pronunciación", "hasta el nivel de fonema"], "nivel de fonema", ("latin", 0)),
 ("ru", "pro02_ru.jpg",["ИИ анализирует произношение", "до уровня фонемы"], "до уровня фонемы", ("latin", 0)),
 ("vn", "pro02_vn.jpg",["AI phân tích phát âm của bạn", "đến từng âm vị"], "đến từng âm vị", ("latin", 0)),
]

def get_font(spec, size):
    kind, idx = spec
    return ImageFont.truetype(CJK, size, index=idx) if kind == "cjk" else ImageFont.truetype(LATIN, size)

def detect_band(a):
    """회색 입력박스(라벨 포함) 밴드의 [cut_top, cut_bot] 자동 검출."""
    H, Wd, _ = a.shape
    cx0, cx1 = int(Wd*0.25), int(Wd*0.75)
    center = a[:, cx0:cx1, :]
    med = np.median(center, axis=1)            # H x3
    mean = med.mean(1)
    rstd = center.reshape(H, -1).std(axis=1)
    # 박스 시그니처: 밝기 240~249 & 약간 푸른빛(B-R>=5)
    isbox = (mean > 240) & (mean < 249) & (med[:, 2] - med[:, 0] >= 5)
    ys = np.where(isbox)[0]
    if len(ys) == 0:
        return None
    groups, s, p = [], ys[0], ys[0]
    for y in ys[1:]:
        if y - p > 5:
            groups.append((s, p)); s = y
        p = y
    groups.append((s, p))
    box_top, box_bot = max(groups, key=lambda g: g[1]-g[0])
    # 위로 스캔: 레벨탭(채색/고변동) 만나면 정지 → 그 아래를 cut_top
    yy = box_top - 3
    while yy > box_top - 220 and yy > 0:
        if rstd[yy] > 22 or mean[yy] < 235:
            break
        yy -= 1
    cut_top = yy + 14
    cut_bot = box_bot + 8
    # 컷 지점을 깨끗한(저변동) 행으로 보정
    while cut_top < box_top and rstd[cut_top] > 10:
        cut_top += 1
    while cut_bot < H-1 and rstd[cut_bot] > 10:
        cut_bot += 1
    return cut_top, cut_bot

def remove_band(shot):
    a = np.asarray(shot.convert("RGB"))
    band = detect_band(a.astype(int))
    if band is None:
        return shot
    ct, cb = band
    return Image.fromarray(np.vstack([a[:ct], a[cb:]]), "RGB"), (ct, cb)

def build(lang, fname, lines, hl, fspec):
    bg = np.repeat(BG_ROWS[:, None, :], W, axis=1)
    canvas = Image.fromarray(bg, "RGB").convert("RGBA")

    orig = Image.open(NEW / fname).convert("RGB")
    res = remove_band(orig)
    if isinstance(res, tuple):
        shot, cut = res
        # 제거한 밴드 높이만큼 세로 복원(stretch) → 다른 장과 동일 프레임(폰 바닥 안 보이게 + 발음 점수 노출)
        shot = shot.resize((orig.width, orig.height), Image.LANCZOS)
    else:
        shot, cut = orig, None
    OW = 1080; B = 18; x = (W - OW) // 2; OT = 500
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

    shadow = Image.new("RGBA", (W, Hc), (0, 0, 0, 0))
    sd = Image.new("RGBA", (OW + 90, OH + 90), (0, 0, 0, 0))
    ImageDraw.Draw(sd).rounded_rectangle([45, 45, 45 + OW, 45 + OH], radius=Rout, fill=(10, 50, 40, 120))
    sd = sd.filter(ImageFilter.GaussianBlur(34))
    shadow.alpha_composite(sd, (x - 45, OT - 39))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(phone, (x, OT))
    canvas = canvas.convert("RGB")

    dr = ImageDraw.Draw(canvas)
    size = 78
    while size > 48:
        font = get_font(fspec, size)
        if max(dr.textlength(l, font=font) for l in lines) <= 1100:
            break
        size -= 2
    font = get_font(fspec, size)
    lh = int(size * 1.34)
    y = 180

    def w(s):
        return dr.textlength(s, font=font)
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

    out = IOS_OUT / lang; out.mkdir(parents=True, exist_ok=True); out = out / f"promo_02_{lang}_1242x2688.png"
    canvas.save(out)
    return out, cut

for lang, fn, lines, hl, fs in LANGS:
    o, cut = build(lang, fn, lines, hl, fs)
    print("OK", o.name, "cut", cut)
