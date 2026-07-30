// ── 숨김 목록 인덱스 재생성 + 서버 즉시 반영 ────────────────────────────────
// 성인물 판정·카탈로그 삭제를 **화면에 바로 먹히게** 하는 마지막 한 걸음.
//
// 왜 이 단계가 따로 필요한가
//   우리 DB에서 `titles/{id}`를 지워도 검색·탐색은 TMDB 프록시라 TMDB가 계속 결과에 실어 보낸다.
//   앱에서 감추는 수단은 서버 프로세스가 들고 있는 메모리 Set이 유일하다 → 서버가 새 id를 모르면
//   지운 성인물이 검색에 그대로 노출된다. 예전에는 TTL(30분)이 지나기만 기다렸는데,
//   그 TTL을 12시간으로 늘린 대신(읽기 비용) 이 즉시 반영 경로를 만들었다.
//
// 하는 일 두 가지
//   ① 파생 인덱스 재생성 — `kdl_index/hidden_titles*` = (titles.hidden==true) ∪ (excluded_titles)
//      원본 전량 스캔 1회. 서버는 이후 이 인덱스 1 read만으로 목록을 적재한다.
//   ② 서버 알림 — POST /api/kdl/hidden-titles/refresh (x-cron-secret) → 메모리 Set 즉시 재적재.
//
// 사용법:
//   node scripts/refresh-hidden-filter.js                # 인덱스 재생성 + 서버 반영
//   node scripts/refresh-hidden-filter.js --no-notify    # 인덱스만(로컬 검증용)
// env: CRON_SECRET(필수 — 서버 알림), KDL_API_BASE(기본 https://multitranslator.onrender.com)
//
// ⚠ 목록을 바꾸는 스크립트(delete-titles · flag-adult-titles · apply-adult-verdicts)는 끝에서
//   이 파일의 refreshHiddenFilter()를 직접 호출한다. 손으로 다시 돌릴 필요는 없다.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API = process.env.KDL_API_BASE || process.env.NEWS_API_BASE || 'https://multitranslator.onrender.com';
const SECRET = process.env.CRON_SECRET || process.env.NEWS_CRON_SECRET || '';

const tty = process.stdout.isTTY;
const paint = (c) => (s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), green = paint('32'), yellow = paint('33'), red = paint('31');

// 다른 스크립트가 끝에서 부르는 진입점.
//   ⚠ 절대 throw하지 않는다 — 이건 후처리다. 여기서 실패해도 앞선 삭제·판정 작업은 이미 끝났고,
//     프로세스를 오류로 죽이면 "삭제가 실패했다"고 오독하게 된다. 실패는 반환값과 경고로만 알린다.
async function refreshHiddenFilter({ notify = true, quiet = false } = {}) {
    const say = (s) => { if (!quiet) console.log(s); };
    const out = { rebuilt: null, notified: false, server: null, error: null };

    // ① 인덱스 재생성
    try {
        const hiddenTitles = require('../lib/hiddenTitles');
        out.rebuilt = await hiddenTitles.rebuildIndex();
        say(`  ${green('✔')} 인덱스 재생성 — 합집합 ${bold(out.rebuilt.count.toLocaleString())}건`
            + dim(` (숨김 ${out.rebuilt.hidden.toLocaleString()} + 삭제 ${out.rebuilt.excluded.toLocaleString()} · ${out.rebuilt.chunks}청크 · ${out.rebuilt.ms}ms)`));
    } catch (e) {
        out.error = `인덱스 재생성 실패: ${e.message}`;
        say(`  ${red('✖')} ${out.error}`);
        say(dim('     서버는 인덱스가 없으면 원본 스캔으로 폴백한다 — 동작은 하지만 비싸다.'));
        return out;   // 인덱스가 없으면 알려도 의미가 없다.
    }

    if (!notify) return out;

    // ② 서버 즉시 반영
    if (!SECRET) {
        out.error = 'CRON_SECRET 없음 — 서버 알림 생략';
        say(`  ${yellow('⚠')} ${out.error}` + dim(` (서버는 TTL 12시간 후 자동 반영. 즉시 반영하려면 .env에 CRON_SECRET)`));
        return out;
    }
    try {
        const r = await fetch(`${API}/api/kdl/hidden-titles/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-cron-secret': SECRET },
            body: JSON.stringify({}),          // 인덱스는 위에서 이미 만들었다 → rebuild 불필요
            signal: AbortSignal.timeout(60000), // Render 인스턴스가 느릴 때를 감안
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        out.notified = true;
        out.server = j;
        say(`  ${green('✔')} 서버 반영 — 적재 ${bold(Number(j.count || 0).toLocaleString())}건`
            + dim(` (직전 ${Number(j.before || 0).toLocaleString()} · ${j.ms}ms · ${API.replace(/^https?:\/\//, '')})`));
    } catch (e) {
        out.error = `서버 알림 실패: ${e.message}`;
        say(`  ${yellow('⚠')} ${out.error}`);
        say(dim('     인덱스는 갱신됐으므로 서버는 TTL(12시간) 후 자동 반영된다. 즉시 필요하면 재실행하거나 재배포.'));
    }
    return out;
}

async function main() {
    const notify = !process.argv.includes('--no-notify');
    console.log(`\n${bold('▶ 숨김 목록 갱신')}${notify ? '' : dim(' · 인덱스만')}`);
    const r = await refreshHiddenFilter({ notify });
    console.log('');
    process.exit(r.rebuilt ? 0 : 1);
}

module.exports = { refreshHiddenFilter };

if (require.main === module) main().catch((e) => { console.error('\n✖', e.message); process.exit(1); });
