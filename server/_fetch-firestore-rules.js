// 임시 진단 스크립트: 배포된 Firestore Security Rules 조회 (읽기 전용)
// 사용법: cd server && node _fetch-firestore-rules.js
require('dotenv').config();
const { GoogleAuth } = require('google-auth-library');

(async () => {
    const sa = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8')
    );
    const projectId = sa.project_id;
    const auth = new GoogleAuth({
        credentials: sa,
        scopes: ['https://www.googleapis.com/auth/firebase', 'https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const relRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`, { headers });
    const releases = await relRes.json();
    if (!relRes.ok) { console.error('releases fetch failed:', JSON.stringify(releases)); process.exit(1); }

    const fsRelease = (releases.releases || []).find(r => r.name.includes('cloud.firestore'));
    if (!fsRelease) { console.error('no cloud.firestore release found. releases:', JSON.stringify(releases.releases?.map(r => r.name))); process.exit(2); }
    console.log('=== release:', fsRelease.name, '| ruleset:', fsRelease.rulesetName, '| updated:', fsRelease.updateTime, '===\n');

    const rsRes = await fetch(`https://firebaserules.googleapis.com/v1/${fsRelease.rulesetName}`, { headers });
    const ruleset = await rsRes.json();
    if (!rsRes.ok) { console.error('ruleset fetch failed:', JSON.stringify(ruleset)); process.exit(3); }
    for (const f of ruleset.source.files) {
        console.log(`--- ${f.name} ---`);
        console.log(f.content);
    }
})().catch(e => { console.error('error:', e.message); process.exit(9); });
