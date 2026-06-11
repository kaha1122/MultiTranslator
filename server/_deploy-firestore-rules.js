// firestore.rules 배포 스크립트 (Firebase Rules REST API)
// 사용법: cd server && node _deploy-firestore-rules.js        ← dry-run (ruleset 생성+문법검증만)
//         cd server && node _deploy-firestore-rules.js --release  ← 실제 release 전환
//         cd server && node _deploy-firestore-rules.js --rollback <rulesetId>  ← 롤백
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

(async () => {
    const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8'));
    const projectId = sa.project_id;
    const auth = new GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/firebase', 'https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const base = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;

    const mode = process.argv[2] || 'dry-run';

    if (mode === '--rollback') {
        const rulesetId = process.argv[3];
        if (!rulesetId) { console.error('rollback에는 rulesetId 필요'); process.exit(1); }
        const res = await fetch(`${base}/releases/cloud.firestore`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ release: { name: `projects/${projectId}/releases/cloud.firestore`, rulesetName: `projects/${projectId}/rulesets/${rulesetId}` } }),
        });
        const out = await res.json();
        if (!res.ok) { console.error('rollback 실패:', JSON.stringify(out)); process.exit(1); }
        console.log('✅ 롤백 완료 →', out.rulesetName);
        return;
    }

    // 1) 새 ruleset 생성 (이 단계에서 문법 검증됨 — 실패해도 운영 영향 0)
    const content = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
    const createRes = await fetch(`${base}/rulesets`, {
        method: 'POST', headers,
        body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] } }),
    });
    const ruleset = await createRes.json();
    if (!createRes.ok) { console.error('❌ ruleset 생성 실패 (문법 오류 가능):\n', JSON.stringify(ruleset, null, 2)); process.exit(1); }
    console.log('✅ ruleset 생성 + 문법 검증 통과:', ruleset.name);

    if (mode !== '--release') {
        console.log('\n(dry-run — release 미전환. 실제 배포: node _deploy-firestore-rules.js --release)');
        return;
    }

    // 2) 현재 release 백업 출력 후 전환
    const curRes = await fetch(`${base}/releases/cloud.firestore`, { headers });
    const cur = await curRes.json();
    console.log('현재(롤백용) ruleset:', cur.rulesetName);

    const relRes = await fetch(`${base}/releases/cloud.firestore`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ release: { name: `projects/${projectId}/releases/cloud.firestore`, rulesetName: ruleset.name } }),
    });
    const rel = await relRes.json();
    if (!relRes.ok) { console.error('❌ release 전환 실패:', JSON.stringify(rel)); process.exit(1); }
    console.log('🚀 배포 완료! 활성 ruleset:', rel.rulesetName);
    console.log('롤백 명령: node _deploy-firestore-rules.js --rollback', cur.rulesetName.split('/').pop());
})().catch(e => { console.error('error:', e.message); process.exit(9); });
