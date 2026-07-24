// ── Dari 프로필 사진 설정 CLI — Storage 업로드 + Auth/users 반영 + 기존 게시물 백필 ──
// 이미지 1장을 kculture Storage `avatars/{dariUid}/avatar.png`에 올리고(공개 읽기 규칙 커버),
// ① Auth photoURL ② users/{uid}.photoURL ③ 기존 Dari 게시물(posts + 스레드 threadRoot)의
// denormalized authorPhoto를 일괄 갱신한다. 멱등 — 재실행 시 같은 경로에 덮어쓰기.
// 사용:
//   node scripts/dari-set-avatar.js --file "D:\Dari_Icon\Dari_icon_256.png" [--dry]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { kcultureApp, kcultureAuth, kcultureDb } = require('../config/firebaseKculture');

const DARI_EMAIL = 'dari@kdramaanylang.com';
const BUCKET = process.env.KCULTURE_STORAGE_BUCKET || 'kculture-f96d8.firebasestorage.app';

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

(async () => {
    if (!kcultureAuth || !kcultureDb) throw new Error('kculture admin 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const dry = process.argv.includes('--dry');
    const file = arg('file', '');
    if (!file || !fs.existsSync(file)) { console.error('사용법: --file <이미지 경로> [--dry]'); process.exit(1); }
    const ext = path.extname(file).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const user = await kcultureAuth.getUserByEmail(DARI_EMAIL);
    const uid = user.uid;
    console.log(`[dari-avatar] uid=${uid} file=${file} (${fs.statSync(file).size}B, ${contentType})`);

    // ① Storage 업로드 — 클라 아바타 컨벤션(avatars/{uid}/) 경로라 storage.rules 공개 읽기 커버
    const objectPath = `avatars/${uid}/avatar${ext}`;
    const token = crypto.randomUUID();
    const photoURL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    if (dry) console.log(`[dari-avatar] (dry) 업로드 예정: gs://${BUCKET}/${objectPath}`);
    else {
        await admin.storage(kcultureApp).bucket(BUCKET).file(objectPath).save(fs.readFileSync(file), {
            metadata: {
                contentType,
                cacheControl: 'public, max-age=86400',
                metadata: { firebaseStorageDownloadTokens: token },
            },
        });
        console.log(`[dari-avatar] 업로드 완료: gs://${BUCKET}/${objectPath}`);
    }
    console.log(`[dari-avatar] photoURL: ${photoURL}`);

    // ② Auth + users 문서
    if (!dry) {
        await kcultureAuth.updateUser(uid, { photoURL });
        await kcultureDb.doc(`users/${uid}`).set({ photoURL }, { merge: true });
        console.log('[dari-avatar] Auth photoURL + users 문서 갱신 완료');
    }

    // ③ 기존 게시물 백필 — posts(리뷰 글) + curation_threads 포인터 경유 threadRoot(스레드)
    const posts = await kcultureDb.collection('posts').where('authorUid', '==', uid).get();
    const pointers = await kcultureDb.collection('curation_threads').get();
    console.log(`[dari-avatar] 백필 대상: posts ${posts.size}건, 스레드 포인터 ${pointers.size}건`);
    if (!dry) {
        const batch = kcultureDb.batch();
        posts.docs.forEach((d) => batch.update(d.ref, { authorPhoto: photoURL }));
        for (const p of pointers.docs) {
            const { titleId, tid } = p.data();
            if (!titleId || !tid) continue;
            const ref = kcultureDb.doc(`titles/${titleId}/discussion/${tid}`);
            const snap = await ref.get();
            if (snap.exists && snap.data().authorUid === uid) batch.update(ref, { authorPhoto: photoURL });
        }
        await batch.commit();
        console.log('[dari-avatar] 백필 완료');
    }
    process.exit(0);
})().catch((e) => { console.error('[dari-avatar] FAIL', e); process.exit(1); });
