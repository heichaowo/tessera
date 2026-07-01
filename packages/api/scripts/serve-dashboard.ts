/**
 * Tiny public server for the live dashboard (tessera.moenet.work via Cloudflare).
 *
 * Serves the static dashboard and proxies ONLY the public read-only network
 * endpoint to the control plane — no other core route is exposed on this port.
 */

const CORE = process.env.CORE_URL || "http://127.0.0.1:3000";

// Real client IP (Cloudflare in front sets cf-connecting-ip / x-forwarded-for)
// forwarded to the control plane so it can per-IP throttle the demo buttons.
function clientIp(req: Request): string {
	return (
		req.headers.get("cf-connecting-ip") ||
		(req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() ||
		""
	);
}
const htmlPath = new URL("../public/dashboard.html", import.meta.url);
// Mapbox public token is injected at serve time (it's a client-side public
// token, but GitHub push-protection blocks it from the repo).
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";

async function renderHtml(): Promise<string> {
	const t = await Bun.file(htmlPath).text();
	return t.replaceAll("__MAPBOX_TOKEN__", MAPBOX_TOKEN);
}

const server = Bun.serve({
	port: Number(process.env.DASHBOARD_PORT) || 80,
	hostname: "0.0.0.0",
	idleTimeout: 30,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(await renderHtml(), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		if (url.pathname === "/api/v1/network") {
			try {
				const r = await fetch(`${CORE}/api/v1/network`, {
					headers: { "cache-control": "no-store" },
				});
				return new Response(await r.text(), {
					headers: {
						"content-type": "application/json",
						"access-control-allow-origin": "*",
						"cache-control": "no-store",
					},
				});
			} catch {
				return new Response(JSON.stringify({ error: "upstream unavailable" }), {
					status: 502,
					headers: { "content-type": "application/json" },
				});
			}
		}

		// Public demo controls (simulate a cheating agent / reset).
		if (url.pathname.startsWith("/api/v1/demo/") && req.method === "POST") {
			try {
				const ip = clientIp(req);
				const r = await fetch(`${CORE}${url.pathname}`, {
					method: "POST",
					headers: ip
						? { "content-type": "application/json", "x-forwarded-for": ip }
						: { "content-type": "application/json" },
					body: await req.text(),
				});
				return new Response(await r.text(), {
					headers: {
						"content-type": "application/json",
						"access-control-allow-origin": "*",
					},
				});
			} catch {
				return new Response(JSON.stringify({ error: "upstream unavailable" }), {
					status: 502,
					headers: { "content-type": "application/json" },
				});
			}
		}

		if (url.pathname === "/health") return new Response("ok");
		return new Response("Not found", { status: 404 });
	},
});

console.log(`Tessera dashboard on http://${server.hostname}:${server.port}`);
