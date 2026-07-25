const ALLOWED_ORIGIN =
  /^(https:\/\/([\w-]+\.)*(ewanhowell\.com|ewanhowell\.pages\.dev|asset-browser\.pages\.dev|minecraft-structure-viewer\.pages\.dev|web\.blockbench\.net)|https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?)$/

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
const PROXY_UA = "Mozilla/5.0 (compatible; cors.ewanhowell.com)"

function isImmutable(target) {
  let url
  try {
    url = new URL(target)
  } catch {
    return false
  }
  if (url.protocol !== "https:" || url.search) return false
  const path = url.pathname
  switch (url.hostname) {
    case "resources.download.minecraft.net": {
      const match = path.match(/^\/([0-9a-f]{2})\/([0-9a-f]{40})$/i)
      return !!match && match[2].toLowerCase().startsWith(match[1].toLowerCase())
    }
    case "piston-data.mojang.com":
    case "launcher.mojang.com":
      return /^\/v1\/objects\/[0-9a-f]{40}\/[^/]+$/i.test(path)
    case "piston-meta.mojang.com":
    case "launchermeta.mojang.com":
      return /^\/v1\/packages\/[0-9a-f]{40}\/[^/]+$/i.test(path)
    case "libraries.minecraft.net":
      return /^(?:\/[\w.+-]+){3,}$/.test(path)
    case "github.com":
      return /^\/Mojang\/bedrock-samples\/archive\/refs\/tags\/[^/]+\.zip$/.test(path)
    default:
      return false
  }
}

function privateCacheControl(upstream) {
  if (!upstream) return "private"
  const directives = upstream
    .split(",")
    .map(directive => directive.trim())
    .filter(directive => directive && !/^(public|s-maxage(=|$)|proxy-revalidate)/i.test(directive))
  if (!directives.some(directive => /^private(=|$)/i.test(directive))) {
    directives.unshift("private")
  }
  return directives.join(", ")
}

function targetUrl(request) {
  const url = new URL(request.url)
  const raw = url.pathname.slice(1) + url.search
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function fixUrl(url) {
  if (url.includes("://")) return url
  if (url.includes(":/")) return url.replace(":/", "://")
  return "http://" + url
}

function uncacheable(status) {
  return new Response(null, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    }
  })
}

async function proxyImmutable(request, target) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "cache-control": "no-store"
      }
    })
  }

  let upstream
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: { accept: "*/*", "user-agent": PROXY_UA }
    })
  } catch {
    return uncacheable(502)
  }

  if (!upstream.ok) return uncacheable(upstream.status)

  const headers = new Headers({
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "content-length",
    "cache-control": IMMUTABLE_CACHE
  })

  const contentType = upstream.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)

  if (!upstream.headers.get("content-encoding")) {
    const length = upstream.headers.get("content-length")
    if (length) headers.set("content-length", length)
  }

  return new Response(upstream.body, { status: upstream.status, headers })
}

async function proxyDynamic(request, target) {
  const reqHeaders = new Headers(request.headers)
  const origin = reqHeaders.get("Origin") || ""

  if (!ALLOWED_ORIGIN.test(origin)) {
    return new Response(JSON.stringify({ code: 403, msg: "Forbidden" }), {
      status: 403,
      headers: {
        "content-type": "application/json",
        "cache-control": "private",
        vary: "Origin"
      }
    })
  }

  const headers = new Headers({
    "access-control-allow-origin": origin,
    vary: "Origin",
    "cache-control": "private",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers":
      reqHeaders.get("Access-Control-Request-Headers") ||
      "Accept, Authorization, Cache-Control, Content-Type, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, Token, x-access-token"
  })

  const url = fixUrl(target)

  if (request.method === "OPTIONS" || url.length < 3 || !url.includes(".")) {
    return new Response(null, { status: 204, headers })
  }

  const forwarded = new Headers()
  const dropHeaders = ["content-length", "content-type", "host", "accept-encoding"]
  for (const [key, value] of reqHeaders.entries()) {
    if (!dropHeaders.includes(key)) forwarded.set(key, value)
  }

  let upstream
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers: forwarded,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body
    })
  } catch (err) {
    headers.set("content-type", "application/json")
    return new Response(JSON.stringify({ code: -1, msg: String(err?.message ?? err) }), {
      status: 502,
      headers
    })
  }

  const contentType = upstream.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)

  if (!upstream.headers.get("content-encoding")) {
    const length = upstream.headers.get("content-length")
    if (length) headers.set("content-length", length)
  }

  headers.set("cache-control", privateCacheControl(upstream.headers.get("cache-control")))

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  })
}

export default {
  async fetch(request) {
    const target = targetUrl(request)
    if (isImmutable(target)) return proxyImmutable(request, target)
    return proxyDynamic(request, target)
  }
}
