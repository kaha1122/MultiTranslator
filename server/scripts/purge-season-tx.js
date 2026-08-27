// ── 회차 줄거리 번역 캐시 오염 퍼지 (2026-08-27) ─────────────────────────────
// seasonTx(lib/seasonTx.js)가 출력 언어 검증 없이 캐시하던 시기, Gemini(flash-lite)가 타깃
// 언어 지시를 무시하고 영어로 번역한 결과가 영구 캐시에 실린 사고 대응
// (실측: Queen of Tears 215720 S1 id — 16회차 전부 영어).
// titles/{id}/media/season{n}_{lang} 문서를 전수 스캔해, 한 회차라도 언어 검증
// (seasonTx.isValidTargetOutput — 배포된 저장 게이트와 동일 판정)에 실패하면 **문서째 삭제**한다.
// 지워진 문서는 다음 사용자 조회가 검증 포함 신 파이프라인으로 자동 재번역(read-through 설계).
//
// 사용법 (server/.env 에 KCULTURE_SERVICE_ACCOUNT_BASE64 필요):
//   node scripts/purge-season-tx.js            # dry-run(기본) — 삭제 후보만 나열
//   node scripts/purge-season-tx.js --apply    # 백업(JSONL) 후 실제 삭제
// 멱등: 지운 문서는 다시 안 잡힌다. 백업: scripts/logs/purge-season-tx-<ts>.jsonl
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { kcultureDb } = require('../config/firebaseKculture');
const { isValidTargetOutput } = require('../lib/seasonTx');

const APPLY = process.argv.includes('--apply');
const DOC_RE = /^season\d+_(.+)$/;

async function run() {
    if (!kcultureDb) { console.error('KCULTURE_SERVICE_ACCOUNT_BASE64 필요'); process.exit(1); }
    // media 서브컬렉션 전수(clips + season 캐시) — 기능이 신설(2026-08-27)이라 문서 수십 건 수준
    const snap = await kcultureDb.collectionGroup('media').get();
    const candidates = [];
    for (const d of snap.docs) {
        const m = d.id.match(DOC_RE);
        if (!m) continue; // clips 등 season 캐시 아님
        const lang = m[1];
        const eps = (d.data() || {}).eps || {};
        const bad = Object.entries(eps).filter(([, v]) => !isValidTargetOutput(v, lang));
        if (bad.length) {
            candidates.push({ path: d.ref.path, lang, total: Object.keys(eps).length, bad: bad.length, data: d.data(), ref: d.ref });
            console.log(`✗ ${d.ref.path} — ${bad.length}/${Object.keys(eps).length} 회차 오염 (샘플: ${JSON.stringify(String(bad[0][1]).slice(0, 60))})`);
        } else {
            console.log(`✓ ${d.ref.path} — ${Object.keys(eps).length}회차 정상`);
        }
    }
    console.log(`\nseason 캐시 ${snap.docs.filter((d) => DOC_RE.test(d.id)).length}건 중 오염 ${candidates.length}건 · ${APPLY ? '⚠ APPLY(실삭제)' : 'dry-run'}`);
    if (!APPLY || !candidates.length) return;

    const logDir = path.join(__dirname, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const backup = path.join(logDir, `purge-season-tx-${Date.now()}.jsonl`);
    for (const c of candidates) {
        fs.appendFileSync(backup, JSON.stringify({ path: c.path, data: c.data }) + '\n');
        await c.ref.delete();
        console.log(`삭제: ${c.path}`);
    }
    console.log(`백업: ${backup}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
