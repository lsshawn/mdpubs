// Choreography for the landing page (/). Markup lives in src/routes/(public)/+page.svelte.
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

	/*
	 * Acts 1 to 5 run in one pinned scene (#story) on one timeline, so the chat
	 * window and the phone never leave the screen and come back. Each act writes
	 * its rows on its own frame scale; act() moves them into the act's slice of
	 * the scene, sized by its scroll budget in hundreds of pixels (see .act-story).
	 */
	{
		const sec = $('#story'),
			stage = $('.sd-stage', sec),
			R = rects(stage);
		const opener = $('.opener', sec),
			chatwin = k(sec, 'chatwin');
		const input = k(sec, 'input'),
			caret = k(sec, 'caret'),
			send = k(sec, 'send'),
			link = k(sec, 'link');
		const fitEl = $('.phone-fit', sec),
			phone = $('.phone', sec),
			screen = k(sec, 'screen');
		const box = k(sec, 'signbox'),
			sheet = k(sec, 'sheet'),
			scrim = k(sec, 'scrim');
		const pad = k(sec, 'pad'),
			ink = k(sec, 'ink'),
			btn = k(sec, 'signBtn'),
			stamp = k(sec, 'stamp');
		const logEl = k(sec, 'log'),
			rows = $$('[data-k="row"]', sec);

		// The arrow cursor clicks the link in the chat, from the stage. The
		// finger lives inside the phone, so it leans with it.
		const cur = cursor(k(sec, 'cursor'));
		const finger = cursor(k(sec, 'finger'));

		// The chat window: rises in act 1, recedes in act 3. One spring, so the two
		// moves never fight over the same style. [y, scale, opacity, blur]
		const win = spring(
			4,
			([y, s, o, b]) => {
				chatwin.style.translate = `0 ${y}px`;
				chatwin.style.scale = s;
				chatwin.style.opacity = o;
				chatwin.style.filter = b > 0.05 ? `blur(${b}px)` : 'none';
			},
			{ initial: [innerHeight, 0.9, 1, 0] }
		);
		const leave = spring(1, ([t]) => blurOut(opener, t), presets.soft);

		const chars = splitChars(k(sec, 'text'));
		const typed = spring(1, ([t]) => typewriter(chars, caret, t, input), { clamp: true });
		const caretOn = flag((on) => (caret.style.opacity = on ? 1 : 0));
		const ready = flag((on) => send.classList.toggle('is-ready', on));
		const pressSend = flag((on) => send.classList.toggle('is-pressed', on));
		const sent = flag((on) => chatwin.classList.toggle('is-sent', on));
		// Before the prompt is sent the input sits alone in the middle of the
		// window; drop slides it down to its place under the thread. build()
		// measures how far that is.
		let lift = 0;
		const place = ([t]) => (input.style.translate = `0 ${-lift * (1 - t)}px`);
		const drop = spring(1, place, presets.soft);
		const bubble = spring(1, ([t]) => blurIn(k(sec, 'bubble'), t));
		const reply = spring(1, ([t]) => blurIn(k(sec, 'reply'), t));
		const linkIn = spring(1, ([t]) => blurIn(link, t, { y: 16 }));
		const pressLink = flag((on) => link.classList.toggle('is-pressed', on));

		const rise = spring(1, ([t]) => {
			phone.style.translate = `0 ${range(t, [0, 1], [innerHeight, 0])}px`;
			phone.style.scale = range(t, [0, 1], [0.9, 1]);
		});
		const caption = (key) => spring(1, ([t]) => blurIn(k(sec, key), t));
		const capOpen = caption('capOpen'),
			capSign = caption('capSign'),
			capLocked = caption('capLocked');

		const len = ink.getTotalLength();
		ink.style.strokeDasharray = `${len}`;
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

		const logIn = spring(1, ([p]) => {
			blurIn(logEl, range(p, [0, 0.3], [0, 1]));
			stagger(rows, range(p, [0.15, 1], [0, 1]), (el, t) => blurIn(el, t), {
				each: 0.15,
				span: 0.4
			});
		});

		// Measure with every moving part at rest, or a cursor aims at where a
		// thing is mid-animation instead of where it lives.
		const phoneAtRest = (fn) =>
			withStyles(phone, { transform: 'none', translate: '0 0', scale: '1' }, fn);
		const local = (el) => {
			const s = screen.getBoundingClientRect(),
				r = el.getBoundingClientRect();
			return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
		};
		const lean = [9, -16, 1.04],
			flat = [0, 0, 1];

		let go;
		const build = () => {
			R.clear();

			// The input's resting spot vs the middle of the window below its bar.
			lift = withStyles(chatwin, { scale: '1', translate: '0 0' }, () =>
				withStyles(input, { translate: '0 0' }, () => {
					const w = chatwin.getBoundingClientRect(),
						bar = $('.chat-bar', chatwin).getBoundingClientRect(),
						r = input.getBoundingClientRect();
					return r.top - (bar.bottom + (w.bottom - bar.bottom - r.height) / 2);
				})
			);
			place(drop.value);
			let at = 0;
			const act = (budget, end, rows) => {
				const from = at;
				at += budget;
				return rows.map(([f, ...e]) => [from + (f / end) * budget, ...e]);
			};

			// Act 3 aims at the link where the chat window settles.
			const L = withStyles(chatwin, { scale: '1', translate: '0 0' }, () => R.of(link));
			const linkPark = [L.left + L.width + 60, L.cy + 80],
				linkAt = [L.left + Math.min(120, L.width * 0.4), L.cy];

			// Act 4 works in the screen's own pixels, phone flat and unscaled.
			const { B, S, P } = withStyles(fitEl, { scale: '1' }, () =>
				phoneAtRest(() =>
					withStyles(sheet, { translate: '0 0' }, () => ({
						B: local(box),
						S: local(btn),
						P: local(pad)
					}))
				)
			);
			const sx = P.w / 300;
			const N = 18;
			const pts = Array.from({ length: N + 1 }, (_, i) => {
				const pt = ink.getPointAtLength((len * i) / N);
				return [P.x + pt.x * sx, P.y + pt.y * sx];
			});
			const boxAt = [B.x + B.w * 0.55, B.y + B.h * 0.6];
			const fingerPark = [B.x + B.w * 0.75, B.y + B.h + 70];
			const drawRows = pts.slice(1).map((p, i) => [18 + (16 * (i + 1)) / N, [finger.pos, p]]);

			go = timeline([
				/* Act 1. The opener blurs away while the chat window rises into place. */
				...act(12, 30, [
					[
						0,
						[win, () => [innerHeight * 0.62, 0.9, 1, 0]],
						[leave, 0],
						[drop, 0],
						[cur.show, false],
						[finger.show, false]
					],
					[20, [leave, 1]],
					[30, [win, [0, 1, 1, 0]]]
				]),

				/* Act 2. The prompt types itself in the middle of the window and sends. The
				   input slides down, then the thread and its link fade in above it. */
				...act(26, 34, [
					[
						0,
						[typed, 0],
						[caretOn, false],
						[ready, false],
						[pressSend, false],
						[sent, false],
						[drop, 0],
						[bubble, 0],
						[reply, 0],
						[linkIn, 0]
					],
					[1, [caretOn, true]],
					[2, [ready, true], [typed, 0]],
					[16, [typed, 1]],
					[18, [pressSend, true], [drop, 0]],
					[19, [pressSend, false], [sent, true], [caretOn, false], [ready, false], [bubble, 0]],
					[22, [drop, 1]],
					[24, [bubble, 1]],
					[25, [reply, 0]],
					[28, [reply, 1], [linkIn, 0]],
					[31, [linkIn, 1]]
				]),

				/* Act 3. The cursor clicks the link. The chat recedes; the client's phone rises. */
				...act(18, 30, [
					[
						0,
						[cur.mode, 'arrow'],
						[cur.pos, linkPark],
						[pressLink, false],
						[win, [0, 1, 1, 0]],
						[rise, 0],
						[capOpen, 0]
					],
					[3, [cur.show, true], [cur.pos, linkPark]],
					[8, [cur.pos, linkAt], [cur.mode, 'hand']],
					[10, [pressLink, true]],
					[11, [pressLink, false], [win, [0, 1, 1, 0]], [rise, 0]],
					[12, [cur.show, false]],
					[18, [win, [-40, 0.86, 0, 8]]],
					[20, [capOpen, 0]],
					[22, [rise, 1]],
					[25, [capOpen, 1]]
				]),

				/* Act 4, the peak. A thumb taps the box, draws a signature, taps Sign. The
				   phone leans toward you while it happens, then the stamp lands. */
				...act(40, 60, [
					[
						0,
						[capOpen, 1],
						[capSign, 0],
						[finger.mode, 'touch'],
						[finger.pos, fingerPark],
						[tapBox, false],
						[sigdrawer, 0],
						[inked, 0],
						[tapBtn, false],
						[signed, false],
						[stampIn, 0],
						[tilt, flat]
					],
					[3, [capOpen, 0], [capSign, 1]],
					[4, [finger.show, true], [finger.pos, fingerPark], [tilt, flat]],
					[9, [finger.pos, boxAt], [tilt, lean]],
					[10, [tapBox, true]],
					[11, [tapBox, false], [sigdrawer, 0]],
					[16, [sigdrawer, 1], [finger.pos, pts[0]]],
					[18, [inked, 0], [finger.pos, pts[0]]],
					...drawRows,
					[34, [inked, 1]],
					[38, [finger.pos, [S.x + S.w / 2, S.y + S.h / 2]]],
					[40, [tapBtn, true]],
					[41, [tapBtn, false], [sigdrawer, 1]],
					[42, [signed, true], [finger.show, false]],
					[46, [sigdrawer, 0], [stampIn, 0], [tilt, lean]],
					[50, [stampIn, 1]],
					[56, [tilt, flat]]
				]),

				/* Act 5. Locked once signed: the activity log fills in beside the phone. */
				...act(14, 20, [
					[0, [capSign, 1], [capLocked, 0], [logIn, 0]],
					[4, [capSign, 0], [capLocked, 1]],
					[6, [logIn, 0]],
					[17, [logIn, 1]],
					[20, [logIn, 1]]
				])
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
