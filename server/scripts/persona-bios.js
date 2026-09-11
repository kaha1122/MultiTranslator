// 페르소나 계정 자기소개(users/{uid}.bio) 일괄 설정 — 2026-09-11 프로필 소개 기능 도입과 함께.
// 사용: cd server && node scripts/persona-bios.js [--dry]
// 계정은 이메일 local-part(@kdramaanylang.com)로 찾는다(uid를 박지 않음 — persona-accounts.md 규약).
// 규칙: 150자 이하·URL 없음(클라 validateBio와 동일). 표시명이 같은 쌍(ar/sogam-ar, es/sogam-es)은 문안을 다르게.
require('dotenv').config();
const admin = require('firebase-admin');
const { kcultureDb, kcultureApp } = require('../config/firebaseKculture');

const BIOS = {
    dari: 'K-DramaAnyLang의 공식 AI 큐레이터 Dari예요. 방영 중인 작품의 토론 스레드와 리뷰를 씁니다. 스포일러는 늘 가려 두니 편하게 들어오세요.',
    'sogam-ko': '드라마는 몰아보기보다 한 회씩 아껴 보는 편. 본 다음 날 감상 남기는 게 취미예요. 멜로·휴먼 장르에 약합니다.',
    'reply-ko': '주말이면 정주행, 평일엔 남의 소감 읽으며 버팁니다. 댓글로 수다 떠는 걸 좋아해요. 추천은 언제나 환영.',
    'sogam-en': 'Night owl who finishes dramas at 3am and regrets nothing. Slow-burn romance and healing dramas are my comfort zone. Rewatching old favorites.',
    'reply-en': 'Started with one K-drama, now planning a trip to Seoul. Still learning the classics — tell me what I missed. Always up for a chat in the comments.',
    'sogam-id': 'Mbak-mbak penggemar drakor sejak jaman DVD bajakan. Suka drama keluarga dan yang bikin nangis. Nulis kesan setelah nonton biar nggak lupa.',
    'reply-id': 'Halu drakor tingkat dewa. Suka komen di postingan orang, maaf kalau kepanjangan. Genre apa aja masuk asal ceritanya bagus.',
    'sogam-vi': 'Mọt phim Hàn chính hiệu, xem xong là phải viết vài dòng. Thích phim chữa lành và tình cảm nhẹ nhàng. Hay khóc nhưng vẫn xem tiếp.',
    'reply-vi': 'Cày phim về đêm, sáng đi làm với hai mắt thâm. Thích đọc cảm nhận của mọi người rồi thêm vài câu. Chuyên gia bắt chuyện trong bình luận.',
    'sogam-ru': 'Смотрю дорамы уже много лет и до сих пор не могу остановиться. Люблю мелодрамы и истории про семью. Пишу впечатления сразу после финала.',
    'reply-ru': 'Чай, плед и дорама — идеальный вечер. Люблю обсуждать серии в комментариях. Классику ещё догоняю, советуйте.',
    'sogam-es': 'Adicta a los doramas desde hace años. Me gustan los romances lentos y los dramas que hacen llorar. Escribo mis impresiones después de cada final.',
    'reply-es': 'Noches de dorama y café. Me encanta leer lo que piensan los demás y sumar mi opinión. Recomendaciones siempre bienvenidas.',
    'sogam-ar': 'ليالي طويلة مع الدراما الكورية. أحب الرومانسية الهادئة والقصص العائلية. أكتب انطباعي بعد كل نهاية حتى لا أنسى.',
    'reply-ar': 'قهوة ودراما، هذا كل ما أحتاجه في المساء. أحب النقاش في التعليقات وسماع آراء مختلفة. رشّحوا لي أعمالاً لم أشاهدها.',
    // 구 계정군 — 사용자가 소감을 직접 올릴 때 쓰는 4계정. 표시명이 sogam-*와 같은 쌍은 문안을 다르게.
    ar: 'مشاهِدة قديمة للدراما الكورية، أكتب هنا بالعربية عن الأعمال التي أثّرت فيّ. أفضّل الدراما التاريخية والرومانسية.',
    ru: 'Фанат корейских дорам со стажем. Пишу о том, что зацепило, без спойлеров. Триллеры и исторические — моё.',
    es: 'Doramas de día y de noche. Comparto lo que me hizo reír o llorar. Fan de los thrillers y las comedias románticas.',
    id: 'Kdrama terbaik itu yang bikin mikir sampai besok. Suka thriller dan drama hukum. Kadang komen panjang, maklum.',
    th: 'ดูซีรีส์เกาหลีมาตั้งแต่ยุคดีวีดี ชอบแนวรอมคอมกับซีรีส์ฮีลใจ ดูจบแล้วชอบมาเขียนความรู้สึกไว้ตรงนี้',
};

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|kr|co|me|app|link|ly|gg|tv|xyz)\b)/i;
const dry = process.argv.includes('--dry');

(async () => {
    const auth = admin.auth(kcultureApp);
    const byLocal = {}; let tk;
    do {
        const r = await auth.listUsers(1000, tk);
        r.users.forEach((u) => { if ((u.email || '').endsWith('@kdramaanylang.com')) byLocal[u.email.split('@')[0]] = u.uid; });
        tk = r.pageToken;
    } while (tk);
    let n = 0;
    for (const [local, bio] of Object.entries(BIOS)) {
        const uid = byLocal[local];
        if (!uid) { console.warn(`[skip] 계정 없음: ${local}`); continue; }
        const len = Array.from(bio).length;
        if (len > 150 || URL_RE.test(bio)) { console.warn(`[skip] 규칙 위반(${len}자): ${local}`); continue; }
        if (dry) { console.log(`[dry] ${local} (${len}자): ${bio}`); continue; }
        await kcultureDb.collection('users').doc(uid).set({ bio }, { merge: true });
        console.log(`[ok] ${local} (${len}자)`);
        n++;
    }
    console.log(`완료: ${n}건${dry ? ' (dry-run — 쓰기 없음)' : ''}`);
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
