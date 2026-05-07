#!/usr/bin/env node
/**
 * check-secrets — 빌드 산출물(dist/)에서 Google API 키 leak 검증.
 *
 * 단순 grep은 Firebase Web config 키처럼 "공개되도록 설계된" 키까지 매번 잡아
 * 진짜 leak가 노이즈에 묻히는 문제가 있다. 이 스크립트는:
 *   1) dist/ 전체에서 AIza 패턴 키를 추출
 *   2) ALLOWLIST에 명시된 알려진/공개 키만 통과
 *   3) 미상 키가 1개라도 있으면 exit 1 (FAIL)
 *
 * ALLOWLIST에 키를 추가할 때는 반드시 reason 주석으로 "왜 공개되어도 안전한지"를 명시.
 * (메모리 secret-hygiene.md / feedback_no_secrets_in_git.md 룰 준수)
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// ALLOWLIST — dist에 inline되어도 안전한 공개 키만 등록.
// 새 키 추가 시 반드시 reason을 함께 명시할 것.
// 비밀 키(GEMINI_API_KEY, GOOGLE_CLOUD_API_KEY, AZURE_*, RC_SECRET 등)는 절대 등록 금지.
// ─────────────────────────────────────────────────────────────────────────
const ALLOWLIST = [
    {
        key: 'AIzaSyCBVNz83WGSbQhcU8ckoK1s72uA5H4s77k',
        reason: 'VITE_FIREBASE_API_KEY — Firebase Web config. 공개되도록 설계된 클라이언트 식별자 (Firebase 보안은 Auth + Security Rules로 처리).',
    },
];

const PATTERN = /AIza[0-9A-Za-z_-]{35}/g;
// dev 전용 호스트가 production 번들에 inline되는 사고 차단.
// (.env.local 사고 2026-05-04 / VITE_API_URL 누락으로 localhost inline 사고 2026-05-07)
// JS 번들(.js)에서만 검사 — index.html이나 source map 등 다른 파일은 영향 없음.
//
// 정밀화: minified 번들에는 코드의 `|| 'http://localhost:5000'` 폴백이 dead code로 남는다.
// 실제 사고는 "VITE_API_URL이 누락되어 production URL이 번들에 아예 없는" 경우.
// → onrender.com 같은 production 호스트가 함께 있으면 localhost는 dead code로 간주 PASS.
// → production 호스트가 없으면 환경변수 누락 사고 → FAIL.
const DEV_HOST_PATTERN = /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g;
const PROD_HOST_PATTERN = /https:\/\/[a-z0-9-]+\.onrender\.com/;
const DIST_DIR = 'dist';
// 검사 제외 확장자 (이미지/폰트 등 — 텍스트가 아니라 false positive 가능성도 매우 낮음)
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.mp3', '.wav', '.pdf']);

const allowSet = new Set(ALLOWLIST.map(a => a.key));
const allowReason = new Map(ALLOWLIST.map(a => [a.key, a.reason]));

function walk(dir) {
    const out = [];
    let entries;
    try { entries = readdirSync(dir); }
    catch { return out; }
    for (const f of entries) {
        const p = join(dir, f);
        let s;
        try { s = statSync(p); } catch { continue; }
        if (s.isDirectory()) {
            out.push(...walk(p));
        } else {
            const dot = f.lastIndexOf('.');
            const ext = dot >= 0 ? f.slice(dot).toLowerCase() : '';
            if (SKIP_EXT.has(ext)) continue;
            out.push(p);
        }
    }
    return out;
}

if (!existsSync(DIST_DIR)) {
    console.error(`❌ ${DIST_DIR}/ not found. Run \`npm run build\` first.`);
    process.exit(2);
}

const found = new Map();  // key → first file where it appeared
const devHostHits = new Map();  // host → first .js file where it appeared
let scannedFiles = 0;
let hasProdHost = false;

for (const file of walk(DIST_DIR)) {
    let content;
    try { content = readFileSync(file, 'utf8'); }
    catch { continue; }
    scannedFiles += 1;
    const matches = content.match(PATTERN);
    if (matches) {
        for (const m of matches) {
            if (!found.has(m)) found.set(m, file);
        }
    }
    // dev/prod host 검사는 JS 번들에 한정 — 다른 파일은 영향 없음
    if (file.endsWith('.js')) {
        const hostMatches = content.match(DEV_HOST_PATTERN);
        if (hostMatches) {
            for (const h of hostMatches) {
                if (!devHostHits.has(h)) devHostHits.set(h, file);
            }
        }
        if (!hasProdHost && PROD_HOST_PATTERN.test(content)) hasProdHost = true;
    }
}

const allKeys = [...found.keys()];
const knownKeys = allKeys.filter(k => allowSet.has(k));
const unknownKeys = allKeys.filter(k => !allowSet.has(k));

if (unknownKeys.length > 0) {
    console.error(`❌ check-secrets FAILED — ${unknownKeys.length} unknown API key(s) in ${DIST_DIR}/:`);
    for (const k of unknownKeys) {
        console.error(`   ${k}`);
        console.error(`     in: ${relative(process.cwd(), found.get(k))}`);
    }
    console.error('');
    console.error('동작 가이드:');
    console.error('  1) 키가 의도된 공개 키(Firebase Web 등) → scripts/check-secrets.mjs ALLOWLIST에 추가 (reason 필수).');
    console.error('  2) 키가 비밀 키 → 즉시 폐기/재발급, 환경변수 정리, dist 재빌드.');
    console.error('     (memory: feedback_no_secrets_in_git.md, 2026-04-24 GCP 정지 사고 룰)');
    process.exit(1);
}

// Production host가 번들에 함께 있으면 localhost는 코드 폴백의 dead code — 실제 호출 경로 아님.
// Production host가 없으면 환경변수 누락 사고 → fail.
if (devHostHits.size > 0 && !hasProdHost) {
    console.error(`❌ check-secrets FAILED — production host 누락 + dev host inlined in JS bundle:`);
    for (const [host, file] of devHostHits) {
        console.error(`   ${host}`);
        console.error(`     in: ${relative(process.cwd(), file)}`);
    }
    console.error('');
    console.error('원인: VITE_API_URL이 빌드 환경에 정의되지 않아 코드의 폴백(`|| http://localhost:5000`)이 활성화됨.');
    console.error('해결: .env.production 파일에 VITE_API_URL=https://...onrender.com 명시 (commit 가능, 비밀 아님).');
    console.error('      이 사고가 production OTA로 나가면 모든 유저가 localhost API 호출 → 앱 동작 불가.');
    process.exit(1);
}

console.log(`✅ check-secrets PASSED — ${knownKeys.length} known key(s), 0 unknown (${scannedFiles} files scanned)`);
for (const k of knownKeys) {
    const masked = `${k.slice(0, 10)}...${k.slice(-4)}`;
    console.log(`   - ${masked}   ${allowReason.get(k)}`);
}
if (hasProdHost && devHostHits.size > 0) {
    console.log(`   - prod host inlined (onrender.com) → localhost는 코드 폴백 dead code로 통과`);
}
process.exit(0);
