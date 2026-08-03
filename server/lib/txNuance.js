// ── UGC 번역 뉘앙스 보존 (K-DramaAnyLang 전용, 2026-08-04) ────────────────────
// 원문에서 뉘앙스 신호(문체·웃음/울음 마커·팬덤 관용어)를 감지해 프롬프트에 구체 지시를 만든다.
// 기존 프롬프트의 "preserve tone, register"는 추상 지시라 Gemini가 문어체로 격상시키는 경향
// ("ㄹㅇ 미쳤다" → "truly impressive")을 못 막았다 — 감지된 신호만큼만 구체화한다.
//
// 전부 정규식 + 정적 테이블(추가 read 0, API 콜 0, ~0ms). 신호가 없으면 scope 한 줄만 나간다.
//
// ⚠ 웃음 마커는 실질 사고 예방이기도 하다 — ㅋㅋㅋ를 영어에서 "kkk"로 음차하면
//   KKK(백인우월단체) 연상. pt-BR에서는 반대로 "kkkk"가 현지 표준 웃음이라 언어별 표가 필수.
//
// 팬덤 로마자 통용어(oppa·unnie·maknae·daebak·makjang)는 번역하지 않고 유지 —
//   2026-08-03 사용자 승인 정책. 이 앱의 독자는 K-콘텐츠 팬이라 "older brother"보다 정확한 뉘앙스.

const HANGUL_RE = /\p{Script=Hangul}/u;
const base = (l) => String(l || '').split('-')[0];
const pick = (map, lang) => map[lang] ?? map[base(lang)];

// ── 웃음/울음 — 타깃 언어권 인터넷 표준 표기 ─────────────────────────────────
const LAUGH = {
    en: '"lol" / "haha"', ko: '"ㅋㅋㅋ"', es: '"jajaja"', 'pt-BR': '"kkkk"', pt: '"kkkk"',
    ja: '"www" or "（笑）"', id: '"wkwkwk"', ru: '"ахаха"', fr: '"mdr"', de: '"haha"',
    vi: '"haha" / "=))"', zh: '"哈哈哈"', 'zh-CN': '"哈哈哈"', 'zh-TW': '"哈哈哈"', ar: '"ههههه"',
};
const TEARS = {
    en: '"😭" or a phrase like "I\'m crying"', ko: '"ㅠㅠ"', es: '"TT" / "😭"', ja: '"😭" or "（泣）"',
    id: '"huhu" / "😭"', vi: '"huhu" / "😭"', // 주력 시장(2026-08-04) — 인니·베트남 공통 울음 표기
};
// 감지: 한글 자모 마커 + 주요 언어권 웃음(원문이 타 언어 → ko 번역 방향도 커버).
// 주력 시장 보강(2026-08-04): 아랍 ههه · 베트남 =))/:)) · haha 2회(인니·베트남 통용) · 인니 wkwk.
const LAUGH_RE = /ㅋㅋ+|ㅎㅎ+|(?:ja){2,}|(?:ha){2,}|(?:wk){2,}|\bk{4,}\b|(?:ах|ха){2,}|ه{3,}|[=:]\){2,}|w{3,}(?![\w.:/])/i;
const TEARS_RE = /[ㅠㅜ]{2,}|T[_.]T|😭|🥲|\b(?:hu){2,}h?\b|\bhiks\b/i;

// ── 문체 신호 ────────────────────────────────────────────────────────────────
const SLANG_RE = /[ㄱ-ㅎ]{2,}|존잼|존버|개꿀|꿀잼|노잼|핵잼|핵노잼|쩐다|쩔어|미쳤|미침|ㄹㅇ|실화냐|찢었/;
const POLITE_RE = /(습니다|십니다|세요|셔요|에요|예요|네요|지요|어요|아요|해요|고요|죠)(?=[\s.!?~…♡♥)]|$)/m;

// scope → 이 글이 어떤 성격의 글인지(레지스터 기준선). routes/community.js의 scope 문자열과 동기.
const SCOPE_DESC = {
    dcomment: 'a spontaneous viewer comment on a show page',
    dreply: 'a quick conversational reply between viewers',
    pcomment: 'a conversational comment in a discussion thread',
    preply: 'a quick conversational reply in a discussion thread',
    post: 'a fan-written review post (composed, but still a fan voice — not journalism)',
    posttitle: 'a short headline of a fan review',
    review: 'a punchy one-line review',
    lounge: 'casual everyday fan chat (like texting friends)',
    compose: 'a community post or comment',
};

// ── K-팬덤 관용어 사전(정적 큐레이션) — 원문에 등장할 때만 주입 ────────────────
// g: 뜻 설명(항상). t: 언어별 자연 표현(있는 언어만 — 없으면 설명만으로 Gemini가 의역).
// 중의어(사이다·고구마·회차)는 설명에 조건을 내장해 오발동을 프롬프트 수준에서 방어.
const FANDOM = [
    { re: /정주행/, s: '정주행', g: 'binge-watching a show from start to finish', t: { en: 'binge-watch', es: 'maratonear', pt: 'maratonar', fr: 'binge-watcher', ja: '一気見', zh: '刷剧', id: 'nonton maraton', ru: 'смотреть запоем', vi: 'cày phim' } },
    { re: /입덕/, s: '입덕', g: 'becoming a fan / falling into a fandom', t: { en: 'became a fan / got hooked' } },
    { re: /케미/, s: '케미', g: 'on-screen chemistry between actors or characters', t: { en: 'chemistry', es: 'química', pt: 'química' } },
    { re: /떡밥/, s: '떡밥', g: 'a foreshadowing hint or teaser planted by the story (NOT literal bait)', t: { en: 'foreshadowing / a plot hint' } },
    { re: /사이다/, s: '사이다', g: 'refreshingly satisfying, cathartic (a scene that vents frustration) — only when describing a scene or plot, not the actual drink', t: { en: 'so satisfying' } },
    { re: /고구마/, s: '고구마', g: 'frustratingly slow or stifling storytelling (opposite of 사이다) — only when describing a scene or plot, not the actual food', t: { en: 'infuriatingly frustrating' } },
    { re: /막장/, s: '막장', g: 'the over-the-top melodrama style — keep the established fandom word "makjang" (you may add a 2-3 word gloss in parentheses once)', t: {} },
    { re: /최애/, s: '최애', g: "one's single most favorite (actor, character, or show)", t: { en: 'my bias / my favorite' } },
    { re: /인생\s?(드라마|영화|작|캐)/, s: '인생드라마/인생작', g: 'an all-time favorite ("the drama of my life")', t: { en: 'all-time favorite' } },
    { re: /과몰입/, s: '과몰입', g: 'being way too invested / over-immersed (fan self-deprecation)', t: { en: 'way too invested' } },
    { re: /순삭/, s: '순삭', g: 'time flew by — it felt deleted in an instant', t: { en: 'it flew by' } },
    { re: /본방\s?사수/, s: '본방사수', g: 'watching the broadcast live as it airs (not later on VOD)', t: { en: 'watching it live' } },
    { re: /(\d+)\s*회차\s*(?:째|정주행|시청|감상|돌|중)/, s: 'N회차', g: 'watching for the Nth time (rewatch count) — only when it means repeat viewings, not an episode number', t: { en: 'my Nth rewatch' } },
    { re: /스포(?![츠일츠])/, s: '스포', g: 'short for spoiler(스포일러)', t: { en: 'spoiler' } },
];

// 팬 호칭·팬덤어 — 로마자 유지 정책 대상. 형(단독)은 형사·형태 등 오매칭이 심해 제외(조사 결합형만).
const KIN_RE = /오빠|언니|누나|막내|애교|대박|형(?=이|아|님|은|도)/;

// ── 조립 ────────────────────────────────────────────────────────────────────
// @param opts.register false면 scope 기준선 생략(batch — 이질적 아이템 묶음이라 단일 기준선이 무의미)
// @returns string[] 프롬프트 라인. register=true면 최소 scope 기준선 1줄, false면 신호 없을 때 [].
function nuanceLines(text, targetLang, targetName, scope, { register = true } = {}) {
    const t = String(text || '');
    if (!t) return [];
    const hangul = HANGUL_RE.test(t);
    const lines = ['', '[Tone & style]'];

    // ① 레지스터 — scope 기준선 + 원문 신호로 구체화
    if (register) {
        const desc = SCOPE_DESC[scope] || 'a community post or comment';
        let reg = `- Register: this is ${desc}.`;
        if (hangul && SLANG_RE.test(t)) {
            reg += ` The writer uses casual internet slang — mirror that energy with natural, current ${targetName} community slang. Do NOT formalize or flatten it; a stiff written register is a tone mistranslation.`;
        } else if (hangul && POLITE_RE.test(t)) {
            reg += ` The tone is polite but friendly — keep it warm and conversational, not stiff or formal.`;
        } else if (hangul) {
            reg += ` The tone is casual spoken Korean — keep it equally casual and direct in ${targetName}.`;
        } else {
            reg += ` Mirror the source's level of formality and energy exactly.`;
        }
        lines.push(reg);
    }

    // ② 웃음/울음 마커 — 타깃 언어권 표기로 변환(강도 유지)
    const laugh = LAUGH_RE.test(t);
    const tears = TEARS_RE.test(t);
    if (laugh || tears) {
        const parts = [];
        if (laugh) parts.push(`laughter → ${pick(LAUGH, targetLang) || `the way ${targetName} internet users write laughter`}`);
        if (tears) parts.push(`crying/sadness → ${pick(TEARS, targetLang) || '"😭"'}`);
        lines.push(`- The text contains laughter/crying markers. Convert them to how ${targetName} internet users actually write them: ${parts.join('; ')} — matching the intensity (more repetitions = stronger). NEVER leave source markers like "ㅋㅋㅋ"/"ㅠㅠ" raw in a non-Korean translation${base(targetLang) === 'en' ? ', and NEVER romanize "ㅋㅋㅋ" as "kkk"' : ''}.`);
    }

    // ③ 팬덤 관용어(등장 항목만, 최대 4)
    let n = 0;
    for (const f of FANDOM) {
        if (n >= 4) break;
        if (!f.re.test(t)) continue;
        const loc = pick(f.t, targetLang);
        lines.push(`- "${f.s}" here means: ${f.g}${loc ? ` — natural ${targetName} rendering: "${loc}"` : ''}. Translate the meaning, never the literal words.`);
        n++;
    }

    // ④ 팬 호칭 로마자 유지(대상어 등장 시)
    if (hangul && KIN_RE.test(t)) {
        lines.push(`- Fan-address/fandom terms (오빠, 언니, 누나, 형, 막내, 애교, 대박): when used as affectionate fan speech rather than literal family relations, keep the romanized forms established among global K-fans — oppa, unnie, nuna, hyung, maknae, aegyo, daebak (in Japanese/Chinese/Arabic use the established fan transliterations like オッパ / 欧巴 / أوبا). Do NOT translate them into kinship words.`);
    }

    return lines.length > 2 ? lines : (register ? lines : []); // 헤더뿐이면(신호 0 + 기준선 생략) 통째 생략
}

// ── 번역 결과 후처리 — 한글 자모 마커 잔존 스크럽(결정적 가드, 2026-08-04) ─────
// 프롬프트 지시만으로는 flash-lite가 ㅋㅋㅋ를 가끔 원문 그대로 남긴다(id 타깃 실측 — vi·ar는
// 변환했는데 id만 불복종한 샘플). 비한국어 번역문에 한글 자모가 남는 것은 어떤 경우든 오출력에
// 가까우므로(예외: "ㅋㅋㅋ가 무슨 뜻?" 같은 메타 인용 — 희귀 케이스, 감수) 서버가 확정 치환한다.
// 웃음(ㅋ/ㅎ)·울음(ㅠ/ㅜ) 연쇄만 대상 — 그 외 자모(ㄹㅇ 등)는 의미가 달라 건드리지 않는다.
const SCRUB_LAUGH = {
    en: 'lol', es: 'jajaja', pt: 'kkkk', 'pt-BR': 'kkkk', ja: 'www', id: 'wkwkwk',
    ru: 'ахаха', fr: 'mdr', de: 'haha', vi: '=))', zh: '哈哈哈', 'zh-CN': '哈哈哈', 'zh-TW': '哈哈哈', ar: 'ههههه',
};
function scrubMarkers(translated, targetLang) {
    if (!translated || base(targetLang) === 'ko') return translated;
    const laugh = pick(SCRUB_LAUGH, targetLang) || 'haha';
    // 한국어 습관대로 단어 끝에 붙어 나오면("maratonㅋㅋㅋ") 공백을 넣어 치환
    return String(translated)
        .replace(/(\S)?[ㅋㅎ]{2,}/g, (m, pre) => (pre ? `${pre} ` : '') + laugh)
        .replace(/(\S)?[ㅠㅜ]{2,}/g, (m, pre) => (pre ? `${pre} ` : '') + '😭');
}

module.exports = { nuanceLines, scrubMarkers, LAUGH_RE, TEARS_RE, SLANG_RE, POLITE_RE };
