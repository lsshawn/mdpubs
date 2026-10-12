/**
 * Open Graph cards (1200×630 PNG), drawn with satori + resvg via @cf-wasm/og.
 *
 * Two layouts: the site card (static/og-default.png is a saved copy of it) and a
 * note card that puts the note's title on the page. Custom-domain pubs are
 * whitelabelled, so their card drops the mdpubs wordmark and shows the host.
 */
import { env } from 'cloudflare:workers';
import { CustomFont, ImageResponse } from '@cf-wasm/og';
import logoSvg from '../../../static/logo.svg?raw';

const INK = '#0a0a0a';
const MUTED = '#6b7280';
const ACCENT = '#422ad5'; // the landing page's oklch(45% 0.24 277)
const PAPER = '#fafafa';

type Node = { type: string; props: Record<string, unknown> };

function el(type: string, style: Record<string, unknown>, children?: unknown, extra = {}): Node {
	return { type, props: { style, children, ...extra } };
}

function logo(height: number): Node {
	const svg = logoSvg.replace('fill="#000"', `fill="${INK}"`);
	return el('img', {}, undefined, {
		src: `data:image/svg+xml;base64,${btoa(svg)}`,
		height,
		width: Math.round((height * 2392) / 992)
	});
}

function frame(children: Node[]): Node {
	return el(
		'div',
		{
			width: '100%',
			height: '100%',
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'space-between',
			padding: '72px 88px',
			background: PAPER,
			borderBottom: `16px solid ${ACCENT}`,
			fontFamily: 'Inter'
		},
		children
	);
}

function siteCard(): Node {
	return frame([
		logo(120),
		el(
			'div',
			{
				display: 'flex',
				flexDirection: 'column',
				fontSize: 68,
				fontWeight: 600,
				letterSpacing: '-0.03em',
				lineHeight: 1.08
			},
			[
				el('div', { color: INK }, 'Write one prompt.'),
				el('div', { color: ACCENT }, 'Get a signed contract back.')
			]
		),
		el('div', { display: 'flex', fontSize: 30, fontWeight: 500, color: MUTED }, 'mdpubs.com')
	]);
}

/** Shrink long titles so most fit in three lines; cut anything past that. */
function titleSize(title: string): number {
	if (title.length <= 32) return 84;
	if (title.length <= 60) return 68;
	return 56;
}

function noteCard(title: string, host: string | null): Node {
	const text = title.length > 120 ? `${title.slice(0, 117).trimEnd()}…` : title;
	return frame([
		host
			? el('div', { display: 'flex', fontSize: 30, fontWeight: 500, color: MUTED }, host)
			: logo(72),
		el(
			'div',
			{
				display: 'block',
				fontSize: titleSize(text),
				fontWeight: 600,
				letterSpacing: '-0.03em',
				lineHeight: 1.1,
				color: INK,
				lineClamp: 3
			},
			text
		),
		host
			? el('div', { display: 'flex' })
			: el('div', { display: 'flex', fontSize: 30, fontWeight: 500, color: MUTED }, 'mdpubs.com')
	]);
}

/**
 * Render a card. With no title it draws the site card.
 *
 * Fonts are TTF from static/fonts (satori can't read woff2). On Workers they're
 * read through the ASSETS binding: event.fetch to our own origin re-enters the
 * Worker, which has no route for them. Vite dev has no binding, so it falls back
 * to a plain fetch of the dev server.
 */
export async function renderOgImage(opts: {
	fetch: typeof fetch;
	origin: string;
	title?: string | null;
	customHost?: string | null;
}): Promise<Response> {
	const font = (weight: 500 | 600) =>
		new CustomFont(
			'Inter',
			async () => {
				const fontUrl = `${opts.origin}/fonts/inter-${weight}.ttf`;
				const res = env?.ASSETS ? await env.ASSETS.fetch(fontUrl) : await opts.fetch(fontUrl);
				if (!res.ok) throw new Error(`font ${fontUrl}: ${res.status}`);
				return res.arrayBuffer();
			},
			{ weight }
		);
	const node = opts.title ? noteCard(opts.title, opts.customHost ?? null) : siteCard();
	return ImageResponse.async(node, {
		width: 1200,
		height: 630,
		fonts: [font(500), font(600)],
		headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' }
	});
}
