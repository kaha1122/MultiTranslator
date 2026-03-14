// ─────────────────────────────────────────────────────────────────────────────
// sw.js - PronunFit Service Worker
//
// [Service Worker란?]
// 브라우저와 서버 사이에서 동작하는 "중간 대리인" 스크립트입니다.
// 이 파일이 있어야 브라우저가 앱을 "설치 가능한 PWA"로 인식하고
// "홈 화면에 추가하시겠어요?" 팝업을 띄워줍니다.
//
// [주요 역할]
// 1. 앱 설치 가능하게 만들기 (필수)
// 2. 핵심 파일 캐싱 → 오프라인에서도 기본 화면 표시 가능
// 3. 앱 업데이트 시 자동으로 새 버전 적용
// ─────────────────────────────────────────────────────────────────────────────

// 캐시 저장소의 이름 (버전을 붙여두면 업데이트 시 구분하기 쉽습니다)
const CACHE_NAME = 'pronunfit-v7';

// 오프라인에서도 보여줄 핵심 파일 목록
// (번역 기능은 인터넷이 필요하지만, 기본 앱 화면은 오프라인에서도 표시)
const CORE_ASSETS = [
    '/',
    '/index.html',
    '/icon-192.png',
    '/icon-512.png',
    '/manifest.json',
];

// ── 1. 설치(install) 이벤트 ─────────────────────────────────────────────────
// Service Worker가 처음 등록될 때 딱 한 번 실행됩니다.
// 핵심 파일들을 캐시에 미리 저장해둡니다.
self.addEventListener('install', (event) => {
    console.log('[SW] 설치 중... 핵심 파일 캐싱 시작');

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] 캐시 저장소 열기 완료, 파일 저장 중...');
            // allSettled: 일부 파일이 실패해도 전체가 멈추지 않게 처리
            return Promise.allSettled(
                CORE_ASSETS.map(url => cache.add(url).catch(err => {
                    console.warn(`[SW] 캐싱 실패 (괜찮음): ${url}`, err);
                }))
            );
        })
    );

    // 새 Service Worker를 기존 버전 대기 없이 즉시 활성화
    self.skipWaiting();
});

// ── 2. 활성화(activate) 이벤트 ──────────────────────────────────────────────
// 새 버전의 Service Worker가 활성화될 때 실행됩니다.
// 오래된 캐시(이전 버전)를 삭제합니다.
self.addEventListener('activate', (event) => {
    console.log('[SW] 활성화됨! 오래된 캐시 정리 중...');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    // 현재 버전 이름과 다른 캐시는 모두 삭제
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log(`[SW] 오래된 캐시 삭제: ${name}`);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            // 새 Service Worker가 즉시 모든 탭에서 적용되도록
            return self.clients.claim();
        })
    );
});

// ── 3. 네트워크 요청 가로채기(fetch) 이벤트 ────────────────────────────────
// 앱이 파일을 요청할 때마다 실행됩니다.
// "네트워크 우선, 실패하면 캐시" 전략을 사용합니다.
// → 항상 최신 데이터를 보여주되, 오프라인이면 저장된 캐시를 보여줍니다.
self.addEventListener('fetch', (event) => {
    // API 요청이나 외부 URL은 캐시하지 않고 그냥 통과시킵니다
    if (!event.request.url.startsWith(self.location.origin)) return;
    // POST 요청(Firebase 저장 등)도 캐싱 대상이 아닙니다
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // 네트워크 응답이 성공하면 캐시도 업데이트
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // 네트워크 실패(오프라인) → 캐시에서 찾아서 반환
                return caches.match(event.request).then(cachedResponse => {
                    if (cachedResponse) return cachedResponse;
                    // 캐시에도 없으면 메인 페이지(/) 반환
                    return caches.match('/');
                });
            })
    );
});
