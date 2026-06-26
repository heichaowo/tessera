/**
 * Tiny public server for the live dashboard (tessera.moenet.work via Cloudflare).
 *
 * Serves the static dashboard and proxies ONLY the public read-only network
 * endpoint to the control plane — no other core route is exposed on this port.
 */

const CORE = process.env.CORE_URL || "http://127.0.0.1:3000";
const htmlPath = new URL("../public/dashboard.html", import.meta.url);

const server = Bun.serve({
	port: Number(process.env.DASHBOARD_PORT) || 80,
	hostname: "0.0.0.0",
	idleTimeout: 30,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(Bun.file(htmlPath), {
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

		if (url.pathname === "/health") return new Response("ok");
		return new Response("Not found", { status: 404 });
	},
});

console.log(`Tessera dashboard on http://${server.hostname}:${server.port}`);
