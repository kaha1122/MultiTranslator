// firebase-messaging-sw.js — Web FCM 백그라운드 메시지 핸들러
//
// [역할]
// - 브라우저가 닫혀있거나 다른 탭일 때 FCM 푸시 수신 → 시스템 알림 표시
// - foreground(앱 열려있음) 메시지는 onMessage 리스너(App.jsx)가 인-앱 처리
//
// [Firebase config 주입]
// - SW는 import.meta.env를 못 읽음 → 메인 앱에서 SW 등록 시 URL params로 config 전달
// - VITE_FIREBASE_* 는 Web config로 공개되도록 설계된 값들 (Firebase 보안은 Auth/Rules로 처리)
//
// [iOS 한계]
// - Safari 16.4+ + 홈 화면 추가된 PWA에서만 푸시 동작. 일반 Safari 탭은 푸시 불가.

importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

const urlParams = new URL(self.location.href).searchParams;
const apiKey = urlParams.get('apiKey');
const projectId = urlParams.get('projectId');
const messagingSenderId = urlParams.get('messagingSenderId');
const appId = urlParams.get('appId');

if (apiKey && projectId && messagingSenderId && appId) {
    firebase.initializeApp({
        apiKey,
        projectId,
        messagingSenderId,
        appId,
        authDomain: `${projectId}.firebaseapp.com`,
        storageBucket: `${projectId}.appspot.com`,
    });

    const messaging = firebase.messaging();

    // 백그라운드 메시지 수신 → 시스템 알림 표시
    messaging.onBackgroundMessage((payload) => {
        console.log('[FCM-SW] background message:', payload);
        const title = payload?.notification?.title || payload?.data?.title || 'PronunFit';
        const body = payload?.notification?.body || payload?.data?.body || '';
        const options = {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            data: payload?.data || {},
        };
        self.registration.showNotification(title, options);
    });
} else {
    console.warn('[FCM-SW] Firebase config 누락 — URL params 확인 필요');
}

// 알림 클릭 → 앱 열기 (이미 열려있으면 포커스)
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification?.data?.url || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        })
    );
});
