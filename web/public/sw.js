// Makes the app installable and lets the shell open offline. Only this site's own
// files are cached; API calls (another origin) always go to the network.
const CACHE = "canvasff-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // pages: network first, so a new deploy shows up right away; cached copy when offline
  // assets: hashed file names never change, so cache first
  const page = req.mode === "navigate";
  e.respondWith(
    (page ? fetch(req).then(save(req)).catch(() => caches.match("/")) : caches.match(req).then((hit) => hit || fetch(req).then(save(req)))),
  );
});

const save = (req) => (res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy));
  }
  return res;
};
