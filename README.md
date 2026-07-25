# CORS Proxy

A Cloudflare Worker that proxies requests to servers which send no CORS headers, so they can be fetched from the browser. It backs the Minecraft tools on [ewanhowell.com](https://ewanhowell.com).

## Usage

```
https://cors.ewanhowell.com/<resource-url>
```

```
https://cors.ewanhowell.com/https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
```

Requests are restricted to an allowlist of origins, except for the immutable URLs below.

## Caching

Minecraft serves most of its files under a content hash, so those URLs can never change and are cached at Cloudflare's edge for a year. Everything else is returned `private`: browsers cache it exactly as the origin server intended, and Cloudflare stores nothing.

| Host | Cached path |
|---|---|
| `resources.download.minecraft.net` | `/<xx>/<sha1>` |
| `piston-data.mojang.com`, `launcher.mojang.com` | `/v1/objects/<sha1>/<file>` |
| `piston-meta.mojang.com`, `launchermeta.mojang.com` | `/v1/packages/<sha1>/<file>` |
| `libraries.minecraft.net` | Maven coordinates |
| `github.com` | `/Mojang/bedrock-samples/archive/refs/tags/<tag>.zip` |

`version_manifest_v2.json` shares a host with the cached metadata but changes with every release, so only the hash-addressed paths qualify.

Cloudflare does not run the Worker on a cache hit, so the origin allowlist cannot be enforced on one. The cached URLs are therefore public and answer `Access-Control-Allow-Origin: *`. They are public Mojang downloads, so this only affects who can pull them through the proxy.

## Development

```
npm install
npm run dev
```

Deploy with `npx wrangler deploy`.

## Legal

Licensed under the MIT License. See [LICENSE](LICENSE).
