const CACHE_NAME = 'timewitness-v1.5';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

// Install Event - cache core static files
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Caching files...');
                return cache.addAll(ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate Event - clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        console.log('[Service Worker] Removing old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event - serve from cache, fall back to network
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request).catch(() => {
                    // Return offline fallback if network fails (e.g. index.html)
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});

// Handle custom background push notifications (Optional / future extension)
self.addEventListener('push', event => {
    let data = { title: 'TimeWitness Notification', body: 'บันทึกเวลาทำงานพยานหลักฐานของคุณ!' };
    if (event.data) {
        try {
            data = event.data.json();
        } catch(e) {
            data = { title: 'TimeWitness Notification', body: event.data.text() };
        }
    }
    
    const options = {
        body: data.body,
        icon: 'https://api.dicebear.com/7.x/bottts/svg?seed=TimeWitness',
        badge: 'https://api.dicebear.com/7.x/bottts/svg?seed=TimeWitness',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: '2'
        }
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Skip waiting message trigger
self.addEventListener('message', event => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
