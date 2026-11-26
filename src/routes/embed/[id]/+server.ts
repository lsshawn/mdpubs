/**
 * GET /embed/[id]?embed=<token>&theme=night|light — what another app puts in
 * its iframe (the `url` from POST /api/notes/[id]/embed).
 *
 * A few hundred bytes of plain HTML, sent at once with no lookups: a grey
 * outline of a document, and behind it a frame that loads the real page
 * (`/<id>?embed=...`). The outline shows from the first instant and fades when
 * the page has arrived, so the host app never shows an empty white box while
 * the note, its comments and its history are fetched.
 *
 * The token is not checked here; the page inside checks it.
 */
import { type RequestEvent } from '@sveltejs/kit';

export function GET({ params, url }: RequestEvent): Response {
	const token = url.searchParams.get('embed') ?? '';
	const night = url.searchParams.get('theme') === 'night';
	const src =
		`/${encodeURIComponent(params.id ?? '')}?embed=${encodeURIComponent(token)}` +
		`&theme=${night ? 'night' : 'light'}`;
	const bg = night ? '#0f172a' : '#ffffff';
	const bar = night ? 'rgba(255,255,255,.09)' : 'rgba(15,23,42,.08)';
	const shine = night ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.7)';
	const line = (w: string, h = '.8rem', mt = '.85rem') =>
		`<div class="b" style="width:${w};height:${h};margin-top:${mt}"></div>`;
	const para = (...widths: string[]) => widths.map((w) => line(w)).join('');

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Document</title>
<style>
html,body{margin:0;height:100%;background:${bg};overflow:hidden}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;opacity:0;transition:opacity .2s}
iframe.in{opacity:1}
#s{position:fixed;inset:0;overflow:hidden;transition:opacity .2s}
#s.out{opacity:0;pointer-events:none}
.c{max-width:56rem;margin:0 auto;padding:1.5rem 1.5rem 0}
@media (min-width:1024px){.c{padding-top:3rem}}
.b{border-radius:.35rem;background:${bar};position:relative;overflow:hidden}
.b::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,${shine},transparent);animation:m 1.3s infinite}
@keyframes m{to{transform:translateX(100%)}}
@media (prefers-reduced-motion:reduce){.b::after{animation:none}}
</style>
</head>
<body>
<div id="s" role="status" aria-label="Loading the document">
<div class="c">
${line('62%', '2rem', '0')}
${line('40%', '1rem', '1rem')}
${line('9rem', '.75rem', '1rem')}
<div style="height:1.5rem"></div>
${line('34%', '1.3rem', '1rem')}
${para('100%', '97%', '92%', '55%')}
<div style="height:.6rem"></div>
${para('98%', '100%', '71%')}
<div style="height:1.2rem"></div>
${line('28%', '1.3rem', '1rem')}
${para('100%', '94%', '99%', '88%', '40%')}
<div style="height:.6rem"></div>
${para('96%', '100%', '63%')}
</div>
</div>
<iframe id="f" title="Document" src="${src}" allow="clipboard-write" onload="this.className='in';document.getElementById('s').className='out'"></iframe>
</body>
</html>`;

	return new Response(html, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'private, no-store',
			'x-robots-tag': 'noindex, nofollow',
			'referrer-policy': 'same-origin'
		}
	});
}
