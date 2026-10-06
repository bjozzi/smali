// HTTP leiðir: /api/g/:kóði (GET staða), /api/g/:kóði/pos (POST staðsetningar), /tile/z/x/y.png (kort)

const LMI_WMS = "https://gis.lmi.is/mapcache/web-mercator/";
const R = 6378137;
const HALF = Math.PI * R;

export async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname;
  let m;

  if ((m = path.match(/^\/tile\/(\d{1,2})\/(\d+)\/(\d+)\.png$/))) {
    return tile(req, url, +m[1], +m[2], +m[3], ctx);
  }

  if ((m = path.match(/^\/api\/g\/([A-Za-z0-9]{4,12})(\/sync)?$/))) {
    const code = m[1].toUpperCase();
    const stub = env.GROUP.get(env.GROUP.idFromName(code));
    if (m[2]) {
      if (req.method !== "POST") return json({ error: "method" }, 405);
      const len = Number(req.headers.get("content-length") || 0);
      if (len > 200_000) return json({ error: "too_big" }, 413);
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "bad_json" }, 400);
      }
      const r = await stub.sync(body, Number(body && body.since) || 0);
      return json(r, r.error ? 400 : 200);
    }
    if (req.method !== "GET") return json({ error: "method" }, 405);
    const since = Number(url.searchParams.get("since") || 0);
    return json(await stub.state(since));
  }

  if (path.startsWith("/api/")) return json({ error: "not_found" }, 404);
  return env.ASSETS.fetch(req);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function tileBbox(z, x, y) {
  const size = (2 * HALF) / 2 ** z;
  const minx = -HALF + x * size;
  const maxy = HALF - y * size;
  return [minx, maxy - size, minx + size, maxy].map((v) => v.toFixed(2)).join(",");
}

export function lmiTileUrl(z, x, y) {
  const q = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: "LMI_Kort",
    STYLES: "",
    SRS: "EPSG:3857",
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
    WIDTH: "256",
    HEIGHT: "256",
  });
  return `${LMI_WMS}?${q}&BBOX=${tileBbox(z, x, y)}`;
}

// Kortaflísar frá Landmælingum Íslands, sóttar í gegnum okkur svo vafrinn megi vista þær offline.
async function tile(req, url, z, x, y, ctx) {
  const n = 2 ** z;
  if (z < 2 || z > 18 || x >= n || y >= n) return new Response("bad tile", { status: 404 });

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(url.origin + url.pathname);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  let up;
  try {
    up = await fetch(lmiTileUrl(z, x, y), { cf: { cacheTtl: 30 * 86400, cacheEverything: true } });
  } catch {
    return new Response("upstream down", { status: 502 });
  }
  const type = up.headers.get("content-type") || "";
  if (!up.ok || !type.startsWith("image/")) {
    return new Response("upstream error", { status: 502, headers: { "cache-control": "no-store" } });
  }
  const res = new Response(up.body, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=2592000",
      "access-control-allow-origin": "*",
    },
  });
  if (cache) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
