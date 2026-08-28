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
    // ── 다의어 고정(2026-08-16, D:\Thread\TRANSLATION-NOTES.md 유형 B) ──────────
    // 한 단어가 여러 뜻을 갖는 표현은 "흔한 쪽"으로 번역이 기울어 의미가 뒤집힌다.
    // 실측: (액션) 합 → choreography → 역번역 "안무". 양방향(한→외, 외→한) 패턴을 함께 둔다.
    { re: /(?:액션|무술|타격)\s*합|합(?:이|을|은)\s*(?:좋|훌륭|미쳤|깔끔|정교|살아|매끄)/, s: '합(액션 합)', g: 'FIGHT choreography — the staging of combat/stunt action, NOT dance. Always keep the "fight/action" qualifier so it cannot be read as dance choreography', t: { en: 'fight choreography', es: 'coreografía de lucha', fr: 'chorégraphie des combats', de: 'Kampfchoreografie', id: 'koreografi laga', vi: 'các pha hành động', ru: 'постановка боёв', ja: 'アクションの殺陣', zh: '动作设计', ar: 'تصميم مشاهد القتال' } },
    { re: /\bchoreograph/i, s: 'choreography', g: 'in a K-drama/action context this means FIGHT choreography (combat staging), NOT dance choreography — translate it as the combat-staging term of the target language', t: { ko: '액션 합', ja: '殺陣', zh: '动作设计' } },
    { re: /\bchemistry\b/i, s: 'chemistry', g: 'on-screen chemistry between actors/characters — never the science subject', t: { ko: '케미', ja: 'ケミ', zh: '化学反应（CP感）' } },
    { re: /떡밥\s*(?:회수|풀)|복선\s*(?:회수|풀)/, s: '떡밥 회수', g: 'paying off earlier foreshadowing — the setup finally lands. NOT literal recovery/collection', t: { en: 'the setup pays off', es: 'el planteamiento se resuelve', id: 'petunjuk awalnya terbayar', vi: 'thu hồi phục bút' } },
];

// 팬 호칭·팬덤어 — 로마자 유지 정책 대상. 형(단독)은 형사·형태 등 오매칭이 심해 제외(조사 결합형만).
const KIN_RE = /오빠|언니|누나|막내|애교|대박|형(?=이|아|님|은|도)/;

// 로마자 유지 대상 팬덤어 — 이미 로마자로 쓰인 채 들어온 경우(makjang·sageuk…)를 일반 단어로
// 풀어버리는 회귀 방어(2026-08-16). 실측: makjang → soap → 역번역 "드라마"로 폄하 뉘앙스 증발.
const ROMANIZED_RE = /\b(makjang|sageuk|chemi|goguma|daebak|aegyo|oppa|unnie|nuna|hyung|maknae|jjinjja)\b/i;

// ── 베트남어 무성조(không dấu) 감지 — 2026-08-29 ──────────────────────────────
// 사고: 베트남 광고 댓글 "sao cái này ko phải phim ma chỉ có ghi hữ vay"(= 영화가 아니라 글만 있네요)를
// "공포 영화가 아니라…"로 오역. 성조 없는 ma(귀신)/mà(그런데)/má(엄마)가 표기상 같고, 원문에 성조가
// *부분적으로* 있어 무성조 ma가 의도적으로 보인 것이 원인. 실측(4문장×3~4회): 지시만으로는 6/12→9/12,
// 원 댓글은 2.5-flash-lite로는 어떤 프롬프트로도 0/4 → 3.1-flash-lite + 이 지시 + restored 필드로 4/4.
// (모델 지정은 routes/community.js KDL_TX_MODEL.) 앞뒤 댓글 맥락 주입은 효과 0이라 채택 안 함.
//
// 감지는 정규식(read 0). "성조 부호가 없다"만으로는 못 잡으므로(부분 성조가 오히려 위험) 베트남 고유
// SMS 축약 + "정서법상 부호가 있어야 하는데 없는 단어"를 센다. 인니어(gak/yg/dgn)·영어와 겹치지 않는
// 토큰만 골라 오발동을 막는다. 2점 이상이면 발동.
const NON_LATIN_RE = /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Thai}]/u;
// 베트남 채팅 축약(뜻은 프롬프트 사전과 동기): ko/k/hok/hong=không, dc/đc=được, ntn=như thế nào, cx=cũng, nhiu=nhiều
const VI_SHORTHAND_RE = /\b(?:ko|hok|hong|dc|đc|ntn|cx|nhiu|nhìu|bik|zậy|zay|hem)\b/gi;
// 부호가 빠진 베트남 단어·구(정서법: không·phải·cái này·vậy·lắm·quá·rồi·nữa·được·mình·tôi·thế nào·tại sao·trời ơi)
const VI_TONELESS_RE = /\b(?:khong|phai|cai nay|cai do|vay|lam|qua|roi|nua|duoc|minh|toi|the nao|tai sao|troi oi|ko co|ko phai|hay qua|dep qua|chi co)\b/gi;

function isTonelessVietnamese(text) {
    const t = String(text || '');
    if (!t || NON_LATIN_RE.test(t)) return false;
    const score = (t.match(VI_SHORTHAND_RE) || []).length + (t.match(VI_TONELESS_RE) || []).length;
    return score >= 2;
}

// 프롬프트 지시(영문). 검증된 문안 — 수정 시 scripts/test-vi-toneless.js 로 회귀 확인.
function tonelessVietnameseLines() {
    return [
        '',
        '[Vietnamese typed without (full) tone marks]',
        '- This Vietnamese text is typed casually: some or all words are MISSING their diacritics/tone marks, typos are common, and texting shorthand is used (ko/k/hok = không, dc/đc = được, vay = vậy, ms = mới, j = gì, r = rồi, ng = người, ntn = như thế nào, cx = cũng). A word without tone marks next to words that have them is still just a fast-typed word — never treat it as deliberately toneless.',
        '- FIRST silently restore the full diacritics of the whole sentence, choosing the reading under which the WHOLE sentence is grammatical and coherent, THEN translate the restored sentence. Restoration means ADDING marks to existing words only — never insert extra words to make a reading work.',
        '- Classic ambiguity "ma": "mà" (but / conjunction) vs "ma" (ghost) vs "má" (mom). If the sentence has "không phải/ko phải … ma … chỉ (có) …", that "ma" IS the conjunction "mà" ("not X, but only Y") — do not read it as "ghost" and do not add a second "mà". "phim ma" = ghost/horror film ONLY when the sentence still works without a conjunction there.',
        '- Do not introduce a meaning ("horror", "ghost", "mom") that exists under only one tone reading unless the rest of the sentence requires it.',
    ];
}

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

    // ④' 이미 로마자로 쓰인 팬덤어 — 그대로 유지(일반 단어로 풀면 뉘앙스 소실 + 역번역 불가)
    if (ROMANIZED_RE.test(t)) {
        lines.push(`- The text already uses romanized K-fandom terms (e.g. makjang, sageuk, chemi, daebak, oppa). KEEP them romanized exactly as written — do NOT replace them with generic words like "soap opera", "period drama" or "chemistry"${base(targetLang) === 'ko' ? ', except when translating INTO Korean, where you should use the Korean original (makjang → 막장, sageuk → 사극, chemi → 케미)' : ''}. You may add a 2-3 word gloss in parentheses once if the meaning would otherwise be unclear.`);
    }

    // ④ 팬 호칭 로마자 유지(대상어 등장 시)
    if (hangul && KIN_RE.test(t)) {
        lines.push(`- Fan-address/fandom terms (오빠, 언니, 누나, 형, 막내, 애교, 대박): when used as affectionate fan speech rather than literal family relations, keep the romanized forms established among global K-fans — oppa, unnie, nuna, hyung, maknae, aegyo, daebak (in Japanese/Chinese/Arabic use the established fan transliterations like オッパ / 欧巴 / أوبا). Do NOT translate them into kinship words.`);
    }

    // ⑤ 베트남어 무성조 — 자체 헤더 블록(위 [Tone & style]과 별개 섹션). ko 타깃 포함 모든 타깃에 적용.
    const viToneless = isTonelessVietnamese(t);
    const out = lines.length > 2 ? lines : (register ? lines : []); // 헤더뿐이면(신호 0 + 기준선 생략) 통째 생략
    return viToneless ? [...out, ...tonelessVietnameseLines()] : out;
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

module.exports = { nuanceLines, scrubMarkers, isTonelessVietnamese, LAUGH_RE, TEARS_RE, SLANG_RE, POLITE_RE };
