// Choreography for /demo. Markup lives in src/routes/(public)/demo/+page.svelte.
// Each block is one act: springs and flags, a timeline of frames, and a scene
// that feeds it scroll progress. Never edit scrolldemo.js for this page.
import {
	scene,
	spring,
	flag,
	timeline,
	rects,
	range,
	blurIn,
	blurOut,
	stagger,
	cursor,
	typewriter,
	splitChars,
	withStyles,
	presets
} from './scrolldemo.js';

export default function run(root) {
	const $ = (s, r = root) => r.querySelector(s);
	const $$ = (s, r = root) => [...r.querySelectorAll(s)];
	const k = (sec, key) => sec.querySelector(`[data-k="${key}"]`);
	const mobile = () => innerWidth <= 760;

	// The phone is 340x660. Shrink it to fit short or narrow screens.
	const fit = () => {
		const s = mobile()
			? Math.min(1, (innerHeight - 190) / 660, (innerWidth - 32) / 340)
			: Math.min(1, (innerHeight - 80) / 660);
		$$('.phone-fit').forEach((el) => (el.style.scale = s));
	};
	fit();
	addEventListener('resize', fit, { passive: true });

	/* Act 1. The opener blurs away while the chat window rises into place. */
	{
		const sec = $('#hero'),
			win = $('.chatwin', sec),
			opener = $('.opener', sec);
		const rise = spring(
			2,
			([y, s]) => {
				win.style.translate = `0 ${y}px`;
				win.style.scale = s;
			},
			{ initial: [innerHeight, 0.9] }
		);
		const leave = spring(1, ([t]) => blurOut(opener, t), presets.soft);
		let go;
		const build = () =>
			(go = timeline([
				[0, [rise, () => [innerHeight * 0.62, 0.9]], [leave, 0]],
				[20, [leave, 1]],
				[30, [rise, [0, 1]]]
			]));
		build();
		scene(sec, { progress: (p) => go(p), resize: build });
	}

	/* Act 2. The prompt types itself, sends, and the reply comes back with a link. */
	{
		const sec = $('#prompt'),
			chatwin = $('.chatwin', sec),
			input = k(sec, 'input');
		const caret = k(sec, 'caret'),
			send = k(sec, 'send'),
			head = k(sec, 'head');
		const chars = splitChars(k(sec, 'text'));
		const typed = spring(1, ([t]) => typewriter(chars, caret, t, input), { clamp: true });
		const caretOn = flag((on) => (caret.style.opacity = on ? 1 : 0));
		const ready = flag((on) => send.classList.toggle('is-ready', on));
		const press = flag((on) => send.classList.toggle('is-pressed', on));
		const sent = flag((on) => chatwin.classList.toggle('is-sent', on));
		const headOut = spring(1, ([t]) => blurOut(head, t), presets.soft);
		const bubble = spring(1, ([t]) => blurIn(k(sec, 'bubble'), t));
		const reply = spring(1, ([t]) => blurIn(k(sec, 'reply'), t));
		const link = spring(1, ([t]) => blurIn(k(sec, 'link'), t, { y: 16 }));
		const go = timeline([
			[
				0,
				[typed, 0],
				[caretOn, true],
				[ready, false],
				[press, false],
				[sent, false],
				[headOut, 0],
				[bubble, 0],
				[reply, 0],
				[link, 0]
			],
			[2, [ready, true]],
			[16, [typed, 1]],
			[18, [press, true], [headOut, 0]],
			[19, [press, false], [sent, true], [caretOn, false], [ready, false], [bubble, 0]],
			[21, [headOut, 1]],
			[22, [bubble, 1]],
			[23, [reply, 0]],
			[26, [reply, 1], [link, 0]],
			[29, [link, 1]],
			[34, [link, 1]]
		]);
		scene(sec, { progress: (p) => go(p) });
	}

	/* Act 3. The cursor clicks the link. The chat recedes; the client's phone rises. */
	{
		const sec = $('#open'),
			stage = $('.sd-stage', sec),
			R = rects(stage);
		const chatwin = $('.chatwin', sec),
			link = k(sec, 'link'),
			phone = $('.phone', sec),
			cap = $('.caption', sec);
		const cur = cursor(k(sec, 'cursor'));
		const press = flag((on) => link.classList.toggle('is-pressed', on));
		const recede = spring(1, ([t]) => {
			chatwin.style.opacity = 1 - t;
			chatwin.style.scale = range(t, [0, 1], [1, 0.86]);
			chatwin.style.translate = `0 ${range(t, [0, 1], [0, -40])}px`;
			chatwin.style.filter = t > 0.01 && t < 0.99 ? `blur(${t * 8}px)` : 'none';
		});
		const rise = spring(1, ([t]) => {
			phone.style.translate = `0 ${range(t, [0, 1], [innerHeight * 0.8, 0])}px`;
			phone.style.scale = range(t, [0, 1], [0.9, 1]);
		});
		const caption = spring(1, ([t]) => blurIn(cap, t));
		let go;
		const build = () => {
			R.clear();
			const L = withStyles(chatwin, { scale: '1', translate: '0 0' }, () => R.of(link));
			const park = [L.left + L.width + 60, L.cy + 80],
				at = [L.left + Math.min(120, L.width * 0.4), L.cy];
			go = timeline([
				[
					0,
					[cur.show, false],
					[cur.mode, 'arrow'],
					[cur.pos, park],
					[press, false],
					[recede, 0],
					[rise, 0],
					[caption, 0]
				],
				[3, [cur.show, true], [cur.pos, park]],
				[8, [cur.pos, at], [cur.mode, 'hand']],
				[10, [press, true]],
				[11, [press, false], [recede, 0], [rise, 0]],
				[12, [cur.show, false]],
				[18, [recede, 1]],
				[20, [caption, 0]],
				[22, [rise, 1]],
				[25, [caption, 1]],
				[30, [caption, 1]]
			]);
		};
		build();
		scene(sec, { progress: (p) => go(p), resize: build });
	}

	/* Act 4, the peak. A thumb taps the box, draws a signature, taps Sign. The
     phone leans toward you while it happens, then the stamp lands. */
	{
		const sec = $('#sign'),
			phone = $('.phone', sec),
			fitEl = $('.phone-fit', sec),
			screen = k(sec, 'screen');
		const box = k(sec, 'signbox'),
			sheet = k(sec, 'sheet'),
			scrim = k(sec, 'scrim');
		const pad = k(sec, 'pad'),
			ink = k(sec, 'ink'),
			btn = k(sec, 'signBtn'),
			stamp = k(sec, 'stamp');
		const cap = $('.caption', sec);
		// The finger lives inside the phone, so it leans with it. Its positions are
		// in the screen's own pixels, measured with the phone flat and unscaled.
		const cur = cursor(k(sec, 'finger'));
		const len = ink.getTotalLength();
		ink.style.strokeDasharray = `${len}`;

		const caption = spring(1, ([t]) => blurIn(cap, t));
		const inked = spring(1, ([t]) => (ink.style.strokeDashoffset = `${len * (1 - t)}`), {
			clamp: true
		});
		const sigdrawer = spring(1, ([t]) => {
			sheet.style.translate = `0 ${range(t, [0, 1], [101, 0])}%`;
			scrim.style.opacity = t;
		});
		const tilt = spring(
			3,
			([rx, ry, s]) => (phone.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`),
			{ initial: [0, 0, 1] }
		);
		const tapBox = flag((on) => box.classList.toggle('is-pressed', on));
		const tapBtn = flag((on) => btn.classList.toggle('is-pressed', on));
		const signed = flag((on) => phone.classList.toggle('is-signed', on));
		const stampIn = spring(
			1,
			([t]) => {
				stamp.style.opacity = Math.min(1, t * 3);
				stamp.style.scale = 1.8 - 0.8 * t;
				stamp.style.rotate = `${-14 + 11 * t}deg`;
			},
			presets.bouncy
		);

		const atRest = (fn) =>
			withStyles(fitEl, { scale: '1' }, () =>
				withStyles(phone, { transform: 'none' }, () => withStyles(sheet, { translate: '0 0' }, fn))
			);
		const local = (el) => {
			const s = screen.getBoundingClientRect(),
				r = el.getBoundingClientRect();
			return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
		};
		const lean = [9, -16, 1.04],
			flat = [0, 0, 1];

		let go;
		const build = () => {
			const { B, S, P } = atRest(() => ({ B: local(box), S: local(btn), P: local(pad) }));
			const sx = P.w / 300;
			const N = 18;
			const pts = Array.from({ length: N + 1 }, (_, i) => {
				const pt = ink.getPointAtLength((len * i) / N);
				return [P.x + pt.x * sx, P.y + pt.y * sx];
			});
			const boxAt = [B.x + B.w * 0.55, B.y + B.h * 0.6];
			const park = [B.x + B.w * 0.75, B.y + B.h + 70];
			const drawRows = pts.slice(1).map((p, i) => [18 + (16 * (i + 1)) / N, [cur.pos, p]]);
			go = timeline([
				[
					0,
					[caption, 0],
					[cur.show, false],
					[cur.mode, 'touch'],
					[cur.pos, park],
					[tapBox, false],
					[sigdrawer, 0],
					[inked, 0],
					[tapBtn, false],
					[signed, false],
					[stampIn, 0],
					[tilt, flat]
				],
				[3, [caption, 1]],
				[4, [cur.show, true], [cur.pos, park], [tilt, flat]],
				[9, [cur.pos, boxAt], [tilt, lean]],
				[10, [tapBox, true]],
				[11, [tapBox, false], [sigdrawer, 0]],
				[16, [sigdrawer, 1], [cur.pos, pts[0]]],
				[18, [inked, 0], [cur.pos, pts[0]]],
				...drawRows,
				[34, [inked, 1]],
				[38, [cur.pos, [S.x + S.w / 2, S.y + S.h / 2]]],
				[40, [tapBtn, true]],
				[41, [tapBtn, false], [sigdrawer, 1]],
				[42, [signed, true], [cur.show, false]],
				[46, [sigdrawer, 0], [stampIn, 0], [tilt, lean]],
				[50, [stampIn, 1]],
				[56, [tilt, flat]],
				[60, [tilt, flat]]
			]);
		};
		build();
		scene(sec, { progress: (p) => go(p), resize: build });
	}

	/* Act 5. The cursor tries to select the signed amount. A lock note pops; the
     activity log fills in beside the phone. */
	{
		const sec = $('#locked'),
			stage = $('.sd-stage', sec),
			R = rects(stage);
		const amount = k(sec, 'amount'),
			tip = k(sec, 'tip'),
			cap = $('.caption', sec);
		const feat = k(sec, 'log'),
			rows = $$('[data-k="row"]', sec);
		const cur = cursor(k(sec, 'cursor'));
		const sel = spring(1, ([s]) => amount.style.setProperty('--sel', s), { clamp: true });
		const tipOn = flag((on) => tip.classList.toggle('is-on', on));
		const caption = spring(1, ([t]) => blurIn(cap, t));
		const logIn = spring(1, ([p]) => {
			blurIn(feat, range(p, [0, 0.3], [0, 1]));
			stagger(rows, range(p, [0.15, 1], [0, 1]), (el, t) => blurIn(el, t), {
				each: 0.2,
				span: 0.4
			});
		});
		let go;
		const build = () => {
			R.clear();
			const a = R.lines(amount).first,
				z = R.lines(amount).last;
			tip.style.translate = `${Math.max(8, Math.min(a.right - 150, innerWidth - 260))}px ${a.top - 46}px`;
			const park = [z.right + 50, z.cy + 70];
			go = timeline([
				[
					0,
					[caption, 0],
					[cur.show, false],
					[cur.mode, 'arrow'],
					[cur.pos, park],
					[sel, 0],
					[tipOn, false],
					[logIn, 0]
				],
				[4, [caption, 1], [cur.show, true], [cur.pos, park]],
				[8, [cur.pos, [a.left - 2, a.cy]], [cur.mode, 'text'], [sel, 0]],
				[12, [cur.pos, [z.right, z.cy]], [sel, 1]],
				[13, [tipOn, true], [cur.mode, 'arrow']],
				[18, [tipOn, false], [sel, 1], [cur.pos, [z.right + 6, z.cy + 10]]],
				[20, [sel, 0], [logIn, 0]],
				[21, [cur.pos, park]],
				[22, [cur.show, false]],
				[31, [logIn, 1]],
				[34, [logIn, 1]]
			]);
		};
		build();
		scene(sec, { progress: (p) => go(p), resize: build });
	}

	/* Act 6. "One price." parts and the long tail swings in between the words. */
	{
		const sec = $('#more'),
			w1 = k(sec, 'w1'),
			w2 = k(sec, 'w2'),
			cards = $$('.feat', sec);
		const part = spring(1, ([t]) => {
			const d1 = range(t, [0, 1], [0, innerWidth * 0.4 + w1.offsetWidth * 0.6]);
			const d2 = range(t, [0, 1], [0, innerWidth * 0.4 + w2.offsetWidth * 0.6]);
			w1.style.translate = `${-d1}px 0`;
			w2.style.translate = `${d2}px 0`;
			w1.style.filter = w2.style.filter =
				t > 0.6 ? `blur(${range(t, [0.6, 1], [0, 6])}px)` : 'none';
		});
		const fan = spring(1, ([p]) =>
			stagger(
				cards,
				p,
				(c, t) => {
					c.style.opacity = range(t, [0, 0.3], [0, 1]);
					c.style.transform = `translateY(${range(t, [0, 1], [40, 0])}px) rotateY(${range(t, [0, 1], [70, 0])}deg) scale(${range(t, [0, 1], [0.6, 1])})`;
					c.style.filter = t < 0.3 ? `blur(${range(t, [0, 0.3], [5, 0])}px)` : 'none';
				},
				{ each: 0.12, span: 0.55 }
			)
		);
		const go = timeline([
			[0, [part, 0], [fan, 0]],
			[10, [part, 0.15]],
			[20, [part, 1], [fan, 0.35]],
			[30, [fan, 1]]
		]);
		scene(sec, { progress: (p) => go(p) });
	}

	/* Close. Word by word, then it holds. */
	{
		const sec = $('#start'),
			words = $$('.w', sec);
		const t = spring(1, ([p]) =>
			stagger(words, p, (el, x) => blurIn(el, x, { y: 50, unit: '%', blur: 10, scale: 0.95 }), {
				each: 0.06,
				span: 0.35
			})
		);
		const go = timeline([
			[0, [t, 0]],
			[10, [t, 1]],
			[12, [t, 1]]
		]);
		scene(sec, { from: 'enter', progress: (p) => go(range(p, [0.25, 0.8], [0, 1])) });
	}
}
