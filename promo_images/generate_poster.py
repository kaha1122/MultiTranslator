#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PronunFit 스토어 프로모 — 포스터형 풀 리디자인 생성기 (Claude 디자인 / SVG→PNG)
원칙: 큰 헤드라인만(서브카피·체크리스트 X) · 큰 폰 목업(HTML 이미지 임베드 X, 직접 그림) ·
      고채도 민트 · 이모지 대신 SVG 아이콘 · P1=히어로 커버 · 언어별 현지화.
샌드박스에 브라우저 설치 불가 → cairosvg 래스터화로 구현.
사용: python3 generate_poster.py --lang ko
"""
import argparse, base64, os
from pathlib import Path
import cairosvg

HERE = Path(__file__).resolve().parent
W, H = 1080, 1920
MINT, MINT_D, INK, YEL = "#00a884", "#0c8470", "#0b3b34", "#ffe14d"
FONT = "Noto Sans CJK KR, Noto Sans KR, sans-serif"

logo_p = HERE / "logo.png"
LOGO = ("data:image/png;base64," + base64.b64encode(logo_p.read_bytes()).decode()) if logo_p.exists() else ""

PHONE_STROKE = 'stroke="#1b2b3a" stroke-width="2"'

def esc(s): return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")

# ── 아이콘 (viewBox 0 0 24 24) ──
ICON = {
 "globe":'<path fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/>',
 "mic":'<path fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
 "plane":'<path fill="{c}" d="M21 15.5l-7-2V7.8c0-.9-.6-1.8-1.5-1.8S11 6.9 11 7.8v5.7l-7 2v1.7l7-1.5v3.3l-1.8 1.2v1.3L12 21l2.8.5v-1.3L13 19v-3.3l7 1.5z"/>',
 "briefcase":'<path fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
 "chat":'<path fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z"/>',
 "sparkle":'<path fill="{c}" d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6zM19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9z"/>',
 "check":'<path fill="none" stroke="{c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M4 12.5l5 5L20 6"/>',
 "bolt":'<path fill="{c}" d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
}
def icon(name, x, y, s, c):
    return f'<svg x="{x}" y="{y}" width="{s}" height="{s}" viewBox="0 0 24 24">{ICON[name].format(c=c)}</svg>'

def rrect(x,y,w,h,r,fill,extra=""):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" {extra}/>'

def text(x,y,s,t,size,weight=800,fill=INK,anchor="start",spacing=0):
    sp = f' letter-spacing="{spacing}"' if spacing else ''
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{sp}>{esc(t)}</text>'

# ── 배경 ──
def bg():
    return f'''
<defs>
<linearGradient id="bgg" x1="0" y1="0" x2="0.5" y2="1">
 <stop offset="0" stop-color="#00c79e"/><stop offset="0.45" stop-color="{MINT}"/><stop offset="1" stop-color="{MINT_D}"/>
</linearGradient>
<radialGradient id="hl1" cx="0.8" cy="0" r="0.8"><stop offset="0" stop-color="#2fe3bf" stop-opacity="0.9"/><stop offset="1" stop-color="#2fe3bf" stop-opacity="0"/></radialGradient>
<radialGradient id="hl2" cx="0" cy="1" r="0.9"><stop offset="0" stop-color="#0a6f5d" stop-opacity="0.8"/><stop offset="1" stop-color="#0a6f5d" stop-opacity="0"/></radialGradient>
<radialGradient id="orb" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<linearGradient id="btn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00c79e"/><stop offset="1" stop-color="{MINT}"/></linearGradient>
<linearGradient id="ab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00b894"/><stop offset="1" stop-color="{MINT}"/></linearGradient>
</defs>
<rect width="{W}" height="{H}" fill="url(#bgg)"/>
<rect width="{W}" height="{H}" fill="url(#hl1)"/>
<rect width="{W}" height="{H}" fill="url(#hl2)"/>
<circle cx="960" cy="40" r="300" fill="url(#orb)"/>
<circle cx="80" cy="1820" r="300" fill="url(#orb)"/>'''

# ── 헤드라인 (왼쪽정렬, highlight 단어만 노랑) ──
def headline(lines, hl, x=92, top=372, size=108, lh=122, fill="#ffffff"):
    out=[]
    y=top
    for line in lines:
        if hl and hl in line:
            a,b = line.split(hl,1)
            parts=f'<tspan>{esc(a)}</tspan><tspan fill="{YEL}">{esc(hl)}</tspan><tspan>{esc(b)}</tspan>'
            out.append(f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="900" fill="{fill}" letter-spacing="-2">{parts}</text>')
        else:
            out.append(text(x,y,size,line,size,900,fill,spacing=-2))
        y+=lh
    return "".join(out)

def kicker(label, ic, x=92, y=200):
    tw = len(label)*30 + 110
    return (f'{rrect(x,y-44,tw,64,32,"#ffffff")}'
            f'{icon(ic, x+26, y-38, 34, MINT)}'
            f'{text(x+78, y+2, 30, label, 30, 800, "#063a30")}')

# ── 폰 프레임 + 화면 ──
PHONE_X, PHONE_W = 210, 660
PHONE_Y, PHONE_H = 600, 1190
SX, SY = PHONE_X+20, PHONE_Y+20
SW, SH = PHONE_W-40, PHONE_H-40

def phone(screen_svg):
    return (f'<circle cx="540" cy="1300" r="360" fill="url(#orb)"/>'
            f'{rrect(PHONE_X,PHONE_Y,PHONE_W,PHONE_H,74,"#0b1220",extra=PHONE_STROKE)}'
            f'<clipPath id="sclip"><rect x="{SX}" y="{SY}" width="{SW}" height="{SH}" rx="56"/></clipPath>'
            f'<g clip-path="url(#sclip)">{rrect(SX,SY,SW,SH,56,"#f4faf8")}{screen_svg}</g>'
            f'{rrect(540-100,SY,200,30,15,"#0b1220")}')  # notch

def appbar(right_html=""):
    h=150
    s=[rrect(SX,SY,SW,h+56,0,"url(#ab)")]  # extends under notch
    s.append(rrect(SX,SY,SW,56,0,"#0b1220"))  # status black strip top behind notch area
    s.append(rrect(SX,SY+40,SW,h,0,"url(#ab)"))
    # logo + name
    s.append(rrect(SX+36,SY+64,56,56,14,"#ffffff"))
    if LOGO: s.append(f'<image x="{SX+40}" y="{SY+68}" width="48" height="48" href="{LOGO}"/>')
    s.append(text(SX+110,SY+128,36,"PronunFit",36,800,"#ffffff"))
    s.append(right_html)
    return "".join(s), SY+40+h

def pill(txt, ok=False):
    w=len(txt)*20+44
    x=SX+SW-36-w; y=SY+74
    fill="#ffffff" if ok else "rgba(255,255,255,0.22)"
    fg=MINT if ok else "#ffffff"
    return rrect(x,y,w,52,26,fill)+text(x+w/2,y+36,26,txt,26,800,fg,"middle")

def levels(l1,l2,l3):
    items=[(l1,False),(l2,True),(l3,False)]
    x=SX+SW-36; y=SY+76; out=[]
    for txt,on in reversed(items):
        w=len(txt)*22+36
        x-=w
        out.append(rrect(x,y,w,48,24,"#ffffff" if on else "rgba(255,255,255,0.18)"))
        out.append(text(x+w/2,y+33,25,txt,25,700,MINT if on else "#d6fff3","middle"))
        x-=8
    return "".join(out)

# ── 화면들 ──
def screen_topic(t):
    bar,by=appbar(levels(t["lv1"],t["lv2"],t["lv3"]))
    s=[bar]
    s.append(text(SX+40,by+64,34,t["topicLabel"],34,800,INK))
    rows=[("plane",t["tp1"],True),("briefcase",t["tp2"],False),("chat",t["tp3"],False)]
    cy=by+100
    for ic,label,sel in rows:
        cardh=132
        s.append(rrect(SX+40,cy,SW-80,cardh,30,"#effaf6" if sel else "#ffffff",
                 extra=f'stroke="{MINT}" stroke-width="3"' if sel else 'stroke="#edf3f1" stroke-width="2"'))
        s.append(rrect(SX+72,cy+34,64,64,18,"#e2f6ef"))
        s.append(icon(ic,SX+86,cy+48,36,MINT))
        s.append(text(SX+160,cy+82,37,label,37,800,INK))
        if sel:
            s.append(f'<circle cx="{SX+SW-104}" cy="{cy+66}" r="28" fill="{MINT}"/>')
            s.append(icon("check",SX+SW-122,cy+48,36,"#ffffff"))
        cy+=cardh+22
    # 버튼
    bh=104; by2=cy+10
    s.append(rrect(SX+40,by2,SW-80,bh,28,"url(#btn)"))
    s.append(icon("sparkle",SX+SW/2-150,by2+30,42,"#ffffff"))
    s.append(text(SX+SW/2+30,by2+66,38,t["genBtn"],38,800,"#ffffff","middle"))
    return "".join(s)

def screen_multi(t):
    bar,by=appbar(pill(t["simulBadge"]))
    s=[bar]
    s.append(text(SX+40,by+64,34,t["multiLabel"],34,800,INK))
    rows=[("EN","#2563eb","Where is the gate?"),("JA","#dc2626","ゲートはどこですか"),("ZH","#d97706","登机口在哪里")]
    cy=by+98
    for code,col,phrase in rows:
        s.append(rrect(SX+40,cy,84,84,22,col))
        s.append(text(SX+82,cy+56,30,code,30,900,"#ffffff","middle"))
        s.append(rrect(SX+144,cy,SW-184,84,22,"#ffffff",extra='stroke="#edf3f1" stroke-width="2"'))
        s.append(text(SX+176,cy+56,36,phrase,36,700,INK))
        s.append(icon("mic",SX+SW-92,cy+22,40,MINT))
        cy+=110
    s.append(text(SX+SW/2,cy+44,30,t["multiHint"],30,700,"#3c7a6c","middle"))
    return "".join(s)

def ring(cx,cy,r,val,label,t):
    import math
    circ=2*math.pi*r
    dash=circ*val/100
    g=[f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#e0f2ec" stroke-width="22"/>']
    g.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{MINT}" stroke-width="22" '
             f'stroke-linecap="round" stroke-dasharray="{dash} {circ}" transform="rotate(-90 {cx} {cy})"/>')
    g.append(f'<circle cx="{cx}" cy="{cy}" r="{r-26}" fill="#ffffff"/>')
    g.append(text(cx,cy+20,58,str(val),58,900,MINT,"middle"))
    g.append(text(cx,cy+r+50,30,label,30,800,INK,"middle"))
    return "".join(g)

def screen_score(t):
    bar,by=appbar(pill(t["scoreBadge"],ok=True))
    s=[bar]
    cy=by+130
    cols=[SX+150,SX+SW/2,SX+SW-150]
    s.append(ring(cols[0],cy,84,92,t["acc"],t))
    s.append(ring(cols[1],cy,84,88,t["flu"],t))
    s.append(ring(cols[2],cy,84,95,t["pro"],t))
    # waveform
    wy=cy+200
    s.append(rrect(SX+40,wy,SW-80,120,26,"#ffffff",extra='stroke="#edf3f1" stroke-width="2"'))
    import math
    n=22; gap=(SW-160)/n
    for i in range(n):
        hh=24+abs(math.sin(i*0.9))*72
        bx=SX+80+i*gap
        s.append(rrect(bx,wy+60-hh/2,12,hh,6,"url(#btn)"))
    # listen btn
    ly=wy+150
    s.append(rrect(SX+40,ly,SW-80,100,26,"#effaf6",extra=f'stroke="{MINT}" stroke-width="3"'))
    s.append(icon("mic",SX+SW/2-140,ly+30,40,MINT))
    s.append(text(SX+SW/2+10,ly+64,36,t["listen"],36,800,MINT,"middle"))
    # ai feedback
    fy=ly+128
    s.append(rrect(SX+40,fy,SW-80,120,24,"#ffffff",extra='stroke="#edf3f1" stroke-width="2"'))
    s.append(rrect(SX+72,fy+38,72,44,10,MINT))
    s.append(text(SX+108,fy+69,26,"AI",26,800,"#ffffff","middle"))
    s.append(text(SX+164,fy+70,31,t["aiFb"],31,600,INK))
    return "".join(s)

def screen_price(t):
    bar,by=appbar(pill("PRO"))
    s=[bar]
    cardx,cardw=SX+40,SW-80
    cy=by+70
    cardh=420
    s.append(rrect(cardx,cy,cardw,cardh,34,"#ffffff",extra='stroke="#edf3f1" stroke-width="2"'))
    cxm=SX+SW/2
    s.append(text(cxm,cy+70,36,t["compPrice"],36,700,"#9aa9a4","middle"))
    s.append(f'<line x1="{cxm-150}" y1="{cy+58}" x2="{cxm+150}" y2="{cy+58}" stroke="#c7d3cf" stroke-width="3"/>')
    s.append(text(cxm-40,cy+170,104,t["proPrice"],104,900,MINT,"middle"))
    s.append(text(cxm+150,cy+170,38,t["perMonth"],38,800,"#3c7a6c","middle"))
    ty=cy+230
    for tag in [t["tag1"],t["tag2"],t["tag3"]]:
        s.append(f'<circle cx="{cardx+60}" cy="{ty+18}" r="26" fill="#e2f6ef"/>')
        s.append(icon("check",cardx+44,ty+2,32,MINT))
        s.append(text(cardx+108,ty+30,34,tag,34,700,INK))
        ty+=64
    # start btn
    bh=104; by2=cy+cardh+30
    s.append(rrect(SX+40,by2,SW-80,bh,28,"url(#btn)"))
    s.append(icon("bolt",SX+SW/2-150,by2+30,42,"#ffffff"))
    s.append(text(SX+SW/2+20,by2+66,38,t["startBtn"],38,800,"#ffffff","middle"))
    return "".join(s)

SCREENS={"topic":screen_topic,"multi":screen_multi,"score":screen_score,"price":screen_price}

# ── 커버 ──
def cover(p):
    s=[]
    cx=540
    s.append(rrect(cx-115,360,230,230,60,"#ffffff"))
    if LOGO: s.append(f'<image x="{cx-85}" y="390" width="170" height="170" href="{LOGO}"/>')
    s.append(text(cx,680,52,"PronunFit",52,900,"#ffffff","middle",spacing=1))
    # headline centered
    y=860
    for line in p["head"].split("\n"):
        hl=p.get("hl")
        if hl and hl in line:
            a,b=line.split(hl,1)
            parts=f'<tspan>{esc(a)}</tspan><tspan fill="{YEL}">{esc(hl)}</tspan><tspan>{esc(b)}</tspan>'
            s.append(f'<text x="{cx}" y="{y}" font-family="{FONT}" font-size="128" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="-3">{parts}</text>')
        else:
            s.append(text(cx,y,128,line,128,900,"#ffffff","middle",spacing=-3))
        y+=140
    # trust row
    ty=y+90
    items=p["trust"]
    total=sum(len(i)*32 for i in items)+ (len(items)-1)*60
    x=cx-total/2
    for i,it in enumerate(items):
        w=len(it)*32
        s.append(text(x+w/2,ty,32,it,32,800,"#ffffff","middle"))
        x+=w
        if i<len(items)-1:
            s.append(f'<circle cx="{x+30}" cy="{ty-10}" r="6" fill="rgba(255,255,255,0.6)"/>')
            x+=60
    return "".join(s)

def panel_svg(p):
    body=bg()
    if p.get("layout")=="cover":
        body+=cover(p)
    else:
        body+=kicker(p["kicker"],p["kIcon"])
        body+=headline(p["head"].split("\n"),p.get("hl"))
        body+=phone(SCREENS[p["screen"]](p["t"]))
    return f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{body}</svg>'

# ── 콘텐츠 ──
T_KO=dict(lv1="쉬움",lv2="보통",lv3="고급",topicLabel="오늘의 주제 선택",
 tp1="여행 · 공항",tp2="비즈니스 미팅",tp3="일상 대화",genBtn="새 지문 생성",
 simulBadge="동시 학습",multiLabel="한 문장, 세 가지 언어",multiHint="한 번에 3개 국어를 함께",
 scoreBadge="평가 완료",acc="정확도",flu="유창성",pro="운율",listen="내 발음 듣기",
 aiFb="'r' 발음을 조금 더 굴려보세요",compPrice="타 앱 월 ₩15,000",proPrice="₩2,500",
 perMonth="/월",tag1="무제한 발음 평가",tag2="무제한 학습 카드",tag3="38개 언어 전체",startBtn="지금 시작하기")

PANELS_KO=[
 dict(layout="cover",head="발음부터 회화까지\nAI 하나로",hl="AI 하나로",trust=["38개 언어","AI 발음 분석","다국어 동시"]),
 dict(layout="phone",screen="topic",t=T_KO,kicker="자기주도 학습",kIcon="sparkle",head="내가 설계하는\n언어 학습",hl="내가 설계"),
 dict(layout="phone",screen="multi",t=T_KO,kicker="다국어 동시 학습",kIcon="globe",head="하나를 배우면\n셋을 얻는다",hl="셋을 얻는다"),
 dict(layout="phone",screen="score",t=T_KO,kicker="초정밀 발음 교정",kIcon="mic",head="음소 단위까지\n발음 교정",hl="음소 단위"),
 dict(layout="phone",screen="price",t=T_KO,kicker="압도적 가성비",kIcon="bolt",head="타 앱 한 달 값으로\n여섯 달의 실력",hl="여섯 달"),
]
SETS={"ko":PANELS_KO}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--lang",default="ko"); a=ap.parse_args()
    panels=SETS[a.lang]
    out=HERE/f"poster_{a.lang}"; out.mkdir(exist_ok=True)
    for i,p in enumerate(panels,1):
        svg=panel_svg(p)
        png=out/f"poster_{i:02d}_{a.lang}.png"
        cairosvg.svg2png(bytestring=svg.encode(),write_to=str(png),output_width=W,output_height=H)
        print("OK",png)

if __name__=="__main__":
    main()
