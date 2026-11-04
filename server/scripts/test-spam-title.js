// TMDB 훼손 제목 치환 점검 — 「학교 2013」(tv:46596) 실데이터(2026-11-05). 실행: node scripts/test-spam-title.js
// TMDB_API_KEY 필요(.env). 카탈로그(kcultureDb)가 있으면 정상 제목으로, 없으면 같은 객체의 다른 필드로 치환된다.
require('dotenv').config();
const scrub = require('../routes/tmdb')._scrubSpamTitles;
const { isSpamTitle } = require('../lib/spamTitle');
(async () => {
    let fail = 0;
    for (const [lang, code] of [['ko-KR', 'ko'], ['zh-CN', 'zh-CN'], ['en-US', 'en']]) {
        const raw = await (await fetch(`https://api.themoviedb.org/3/tv/46596?api_key=${process.env.TMDB_API_KEY}&language=${lang}`)).json();
        const before = `${raw.name} | ${raw.original_name}`;
        const out = await scrub(raw, lang);
        const bad = isSpamTitle(out.name) || isSpamTitle(out.original_name);
        if (bad) fail++;
        console.log(`${bad ? '❌' : '✅'} ${code}: "${before}" → "${out.name} | ${out.original_name}"`);
    }
    const person = await (await fetch(`https://api.themoviedb.org/3/person/1095818?api_key=${process.env.TMDB_API_KEY}&language=ko-KR&append_to_response=combined_credits`)).json();
    await scrub(person, 'ko-KR');
    const w = person.combined_credits.cast.find((c) => c.id === 46596);
    const bad = isSpamTitle(w?.name) || isSpamTitle(w?.original_name);
    if (bad) fail++;
    console.log(`${bad ? '❌' : '✅'} 인물 필모(이종석 ko): "${w?.name} | ${w?.original_name}"`);
    process.exit(fail ? 1 : 0);
})();
