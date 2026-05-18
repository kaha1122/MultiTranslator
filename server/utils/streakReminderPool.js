// Streak 정기 리마인더 메시지 풀 — local 13:00 FCM 발송용 (2026-05-18)
// 클라이언트 src/locales/{lang}.json 의 streak.reminder.* 키와 동일한 메시지를
// 서버 측에 inline (Render는 server/ 디렉토리만 deploy하므로 ../src 접근 불가).
//
// streakCurrent → bucket → { title, body } 매핑.
// 같은 bucket 안에서도 본문 2개를 요일 mod 2로 rotate하여 fatigue 감소.

const BUCKETS = [
    { max: 0,   key: 'start' },   // 0일: 시작 안내
    { max: 2,   key: 'early' },   // 1~2일: 막 시작
    { max: 6,   key: 'forming' }, // 3~6일: 흐름 형성
    { max: 13,  key: 'week1' },   // 7~13일: 1주 돌파
    { max: 29,  key: 'week2' },   // 14~29일: 2주 넘김
    { max: 99,  key: 'month' },   // 30~99일: 한 달 습관
];
// 100+ → 'legend'

function pickBucket(streakCurrent) {
    const n = Math.max(0, Math.floor(streakCurrent || 0));
    for (const b of BUCKETS) {
        if (n <= b.max) return b.key;
    }
    return 'legend';
}

// 10개 언어 × 7 buckets × (title + body0 + body1) 메시지 풀
// 클라 src/locales/*.json 의 streak.reminder.* 와 동일. 동기화 시 양쪽 갱신.
const STREAK_REMINDER_MESSAGES = {
    'ko': {
        start:   { title: '오늘부터 Streak 시작!', body0: '카드 3장 학습으로 첫 Streak를 만들어 보세요', body1: '오늘이 시작하기 가장 좋은 날입니다' },
        early:   { title: 'Streak {n}일째!', body0: '막 시작한 흐름, 오늘도 이어가세요', body1: '짧은 시간이라도 매일이 중요해요' },
        forming: { title: '벌써 Streak {n}일!', body0: '오늘도 카드 3장으로 흐름 유지해 볼까요?', body1: '꾸준함이 무기예요. {n}일째 응원합니다' },
        week1:   { title: '1주 돌파! Streak {n}일째', body0: '이대로만 가면 보너스가 보입니다', body1: '한 주를 이어온 당신, 오늘도 한 장!' },
        week2:   { title: '대단해요! Streak {n}일째', body0: '2주 넘은 습관, 정말 자랑스럽습니다', body1: '이제는 자연스러운 일상이 됐죠?' },
        month:   { title: 'Streak {n}일! 한 달의 습관', body0: '단단해진 학습 루틴, 오늘도 가볍게!', body1: '이 페이스라면 마스터까지 멀지 않아요' },
        legend:  { title: '전설의 Streak {n}일!', body0: '진정한 마스터, 오늘도 한 장!', body1: '당신의 꾸준함이 곧 실력입니다' },
    },
    'en': {
        start:   { title: 'Start your Streak today!', body0: 'Practice 3 cards to build your first Streak', body1: 'Today is the perfect day to begin' },
        early:   { title: 'Streak day {n}!', body0: 'Keep the momentum going', body1: 'Even a few minutes makes a difference' },
        forming: { title: 'Already {n} days!', body0: '3 cards today to keep the flow', body1: 'Consistency wins. Day {n}, cheering you on!' },
        week1:   { title: '1 week strong! Day {n}', body0: 'Stay on track — bonus is in sight', body1: 'One card today keeps the chain alive' },
        week2:   { title: 'Amazing! Day {n}', body0: 'Over 2 weeks — truly impressive', body1: 'Learning has become your routine' },
        month:   { title: 'Day {n}! A monthly habit', body0: 'Solid routine — keep it light today', body1: 'Mastery is closer at this pace' },
        legend:  { title: 'Legendary Streak: day {n}!', body0: 'True master — one card today!', body1: 'Your consistency is your skill' },
    },
    'ja': {
        start:   { title: '今日からStreakスタート！', body0: 'カード3枚学習で最初のStreakを作りましょう', body1: '始めるのに最高の日です' },
        early:   { title: 'Streak {n}日目！', body0: '始まった流れ、今日も続けましょう', body1: '短い時間でも毎日が大切です' },
        forming: { title: 'もう{n}日！', body0: '今日もカード3枚で流れを保ちましょう', body1: '継続が力。{n}日目も応援します' },
        week1:   { title: '1週間突破！{n}日目', body0: 'このまま行けばボーナスが見えます', body1: '1週間続けたあなた、今日も1枚！' },
        week2:   { title: 'すごい！{n}日目', body0: '2週間超えの習慣、本当に立派です', body1: 'もう自然な日常になりましたね' },
        month:   { title: '{n}日！1ヶ月の習慣', body0: '確立されたルーティン、今日も気軽に！', body1: 'このペースならマスターも近い' },
        legend:  { title: '伝説のStreak {n}日！', body0: '真のマスター、今日も1枚！', body1: 'あなたの継続力こそが実力です' },
    },
    'zh-CN': {
        start:   { title: '今天开启 Streak！', body0: '学习3张卡片，开始你的第一个 Streak', body1: '今天是开始的最佳一天' },
        early:   { title: 'Streak {n} 天！', body0: '刚开始的势头，今天继续保持', body1: '短短几分钟，每天都重要' },
        forming: { title: '已经 {n} 天！', body0: '今天3张卡片继续保持节奏', body1: '坚持就是力量。{n} 天为你加油' },
        week1:   { title: '突破1周！{n} 天', body0: '照此下去奖励就在眼前', body1: '坚持1周的你，今天也来一张吧！' },
        week2:   { title: '了不起！{n} 天', body0: '超过2周的习惯，真的很棒', body1: '已经成为日常了吧？' },
        month:   { title: '{n} 天！一个月的习惯', body0: '稳固的学习习惯，今天也轻松一下！', body1: '照这个节奏离掌握不远了' },
        legend:  { title: '传奇 Streak {n} 天！', body0: '真正的高手，今天也来一张！', body1: '你的坚持就是实力' },
    },
    'vi': {
        start:   { title: 'Bắt đầu Streak hôm nay!', body0: 'Học 3 thẻ để tạo Streak đầu tiên', body1: 'Hôm nay là ngày hoàn hảo để bắt đầu' },
        early:   { title: 'Streak ngày {n}!', body0: 'Giữ đà mới bắt đầu, hôm nay tiếp tục nhé', body1: 'Vài phút mỗi ngày cũng quan trọng' },
        forming: { title: 'Đã {n} ngày!', body0: 'Hôm nay 3 thẻ để giữ nhịp', body1: 'Kiên trì là sức mạnh. Ngày {n} cùng cố lên!' },
        week1:   { title: 'Vượt 1 tuần! Ngày {n}', body0: 'Cứ thế này phần thưởng sắp đến', body1: 'Đã giữ 1 tuần, hôm nay 1 thẻ nữa!' },
        week2:   { title: 'Tuyệt vời! Ngày {n}', body0: 'Hơn 2 tuần — thật đáng ngưỡng mộ', body1: 'Đã thành thói quen tự nhiên rồi nhỉ?' },
        month:   { title: 'Ngày {n}! Thói quen 1 tháng', body0: 'Thói quen vững chắc, hôm nay nhẹ nhàng thôi!', body1: 'Với nhịp này, làm chủ không còn xa' },
        legend:  { title: 'Streak huyền thoại {n} ngày!', body0: 'Bậc thầy thực sự, hôm nay 1 thẻ!', body1: 'Sự kiên trì của bạn là kỹ năng' },
    },
    'es': {
        start:   { title: '¡Comienza tu Streak hoy!', body0: 'Estudia 3 tarjetas para crear tu primera Streak', body1: 'Hoy es el día perfecto para empezar' },
        early:   { title: '¡Streak día {n}!', body0: 'Mantén el impulso, sigue hoy', body1: 'Unos minutos al día cuentan' },
        forming: { title: '¡Ya {n} días!', body0: '3 tarjetas hoy para mantener el ritmo', body1: 'La constancia gana. ¡Día {n}, te animamos!' },
        week1:   { title: '¡Semana completa! Día {n}', body0: 'Sigue así, el bono está cerca', body1: 'Una semana cumplida, ¡una tarjeta más hoy!' },
        week2:   { title: '¡Genial! Día {n}', body0: 'Más de 2 semanas — realmente impresionante', body1: 'Ya es tu rutina natural, ¿verdad?' },
        month:   { title: '¡Día {n}! Hábito mensual', body0: 'Rutina sólida — ¡hoy ligero!', body1: 'A este ritmo, el dominio está cerca' },
        legend:  { title: '¡Streak legendaria de {n} días!', body0: 'Verdadero maestro — ¡una tarjeta hoy!', body1: 'Tu constancia es tu habilidad' },
    },
    'fr': {
        start:   { title: "Commencez votre Streak aujourd'hui !", body0: 'Étudiez 3 cartes pour créer votre premier Streak', body1: "Aujourd'hui est le jour parfait pour commencer" },
        early:   { title: 'Streak jour {n} !', body0: "Gardez l'élan, continuons aujourd'hui", body1: 'Quelques minutes par jour, ça compte' },
        forming: { title: 'Déjà {n} jours !', body0: "3 cartes aujourd'hui pour maintenir le rythme", body1: 'La constance paie. Jour {n}, on vous soutient !' },
        week1:   { title: '1 semaine franchie ! Jour {n}', body0: 'Continuez ainsi, le bonus approche', body1: "Une semaine tenue, une carte de plus aujourd'hui !" },
        week2:   { title: 'Bravo ! Jour {n}', body0: 'Plus de 2 semaines — vraiment impressionnant', body1: "C'est devenu une routine naturelle, non ?" },
        month:   { title: 'Jour {n} ! Habitude mensuelle', body0: "Routine solide, allez-y léger aujourd'hui !", body1: 'À ce rythme, la maîtrise approche' },
        legend:  { title: 'Streak légendaire {n} jours !', body0: "Vrai maître, une carte aujourd'hui !", body1: 'Votre constance fait votre compétence' },
    },
    'de': {
        start:   { title: 'Starte heute deine Streak!', body0: 'Lerne 3 Karten und beginne deine erste Streak', body1: 'Heute ist der perfekte Tag zum Anfangen' },
        early:   { title: 'Streak Tag {n}!', body0: 'Halte den Schwung, mach heute weiter', body1: 'Auch ein paar Minuten am Tag zählen' },
        forming: { title: 'Schon {n} Tage!', body0: 'Heute 3 Karten, um den Rhythmus zu halten', body1: 'Beständigkeit gewinnt. Tag {n} — wir feuern dich an!' },
        week1:   { title: '1 Woche geschafft! Tag {n}', body0: 'Weiter so, der Bonus ist in Sicht', body1: 'Eine Woche gehalten, heute eine Karte mehr!' },
        week2:   { title: 'Großartig! Tag {n}', body0: 'Über 2 Wochen — wirklich beeindruckend', body1: 'Lernen ist jetzt deine Routine' },
        month:   { title: 'Tag {n}! Eine monatliche Gewohnheit', body0: 'Solide Routine — heute ganz locker!', body1: 'In diesem Tempo ist Meisterschaft nah' },
        legend:  { title: 'Legendäre Streak von {n} Tagen!', body0: 'Wahrer Meister — heute eine Karte!', body1: 'Deine Beständigkeit ist dein Können' },
    },
    'ru': {
        start:   { title: 'Начните Streak сегодня!', body0: 'Изучите 3 карточки, чтобы создать первую Streak', body1: 'Сегодня идеальный день для начала' },
        early:   { title: 'Streak день {n}!', body0: 'Сохраняйте импульс, продолжайте сегодня', body1: 'Даже несколько минут в день — это важно' },
        forming: { title: 'Уже {n} дней!', body0: '3 карточки сегодня, чтобы сохранить ритм', body1: 'Постоянство побеждает. День {n}, мы за вас!' },
        week1:   { title: '1 неделя! День {n}', body0: 'Так держать — бонус близко', body1: 'Неделя позади, ещё одна карточка сегодня!' },
        week2:   { title: 'Здорово! День {n}', body0: 'Более 2 недель — действительно впечатляет', body1: 'Стало естественной рутиной, верно?' },
        month:   { title: 'День {n}! Месячная привычка', body0: 'Прочная рутина — сегодня легко!', body1: 'В таком темпе мастерство рядом' },
        legend:  { title: 'Легендарная Streak {n} дней!', body0: 'Настоящий мастер — одна карточка сегодня!', body1: 'Ваше постоянство — это ваш навык' },
    },
    'pt-BR': {
        start:   { title: 'Comece sua Streak hoje!', body0: 'Estude 3 cartões para criar sua primeira Streak', body1: 'Hoje é o dia perfeito para começar' },
        early:   { title: 'Streak dia {n}!', body0: 'Mantenha o ritmo, continue hoje', body1: 'Alguns minutos por dia já contam' },
        forming: { title: 'Já {n} dias!', body0: '3 cartões hoje para manter o fluxo', body1: 'Constância vence. Dia {n}, estamos torcendo!' },
        week1:   { title: '1 semana! Dia {n}', body0: 'Continue assim, o bônus está chegando', body1: 'Uma semana mantida, mais um cartão hoje!' },
        week2:   { title: 'Incrível! Dia {n}', body0: 'Mais de 2 semanas — realmente impressionante', body1: 'Já virou rotina natural, né?' },
        month:   { title: 'Dia {n}! Hábito mensal', body0: 'Rotina sólida — hoje leve!', body1: 'Nesse ritmo, o domínio está próximo' },
        legend:  { title: 'Streak lendária de {n} dias!', body0: 'Verdadeiro mestre — um cartão hoje!', body1: 'Sua constância é sua habilidade' },
    },
};

/**
 * streakCurrent + lang(+now) → { title, body, bucket } 메시지 1쌍 반환.
 * @param {number} streakCurrent
 * @param {string} lang — 'ko'|'en'|'ja'|'zh-CN'|'vi'|'es'|'fr'|'de'|'ru'|'pt-BR'
 * @param {Date} [now] — 요일 mod 2 rotate 기준
 */
function pickStreakReminderMessage(streakCurrent, lang, now = new Date()) {
    const bucket = pickBucket(streakCurrent);
    const variantIdx = now.getDay() % 2; // 0 or 1
    const n = Math.max(0, Math.floor(streakCurrent || 0));

    const pool = STREAK_REMINDER_MESSAGES[lang] || STREAK_REMINDER_MESSAGES['en'];
    const entry = pool[bucket] || STREAK_REMINDER_MESSAGES['en'][bucket];

    const rawTitle = entry.title || '';
    const rawBody = (variantIdx === 0 ? entry.body0 : entry.body1) || entry.body0 || '';

    return {
        title: rawTitle.replace(/\{n\}/g, String(n)),
        body: rawBody.replace(/\{n\}/g, String(n)),
        bucket,
        variantIdx,
    };
}

module.exports = { pickBucket, pickStreakReminderMessage };
