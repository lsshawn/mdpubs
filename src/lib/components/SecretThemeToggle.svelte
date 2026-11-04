<script lang="ts">
	/**
	 * Hidden light/night toggle: double-click or double-tap the top-right
	 * corner of any page. No element, so it never blocks the buttons there.
	 * The choice persists in localStorage; app.html applies it before paint.
	 */
	const ZONE = 48;
	const WINDOW_MS = 350;
	let lastTap = 0;

	function onPointerUp(e: PointerEvent) {
		if (e.clientX < window.innerWidth - ZONE || e.clientY > ZONE) {
			lastTap = 0;
			return;
		}
		const now = e.timeStamp;
		if (now - lastTap > WINDOW_MS) {
			lastTap = now;
			return;
		}
		lastTap = 0;
		const root = document.documentElement;
		const next = root.dataset.theme === 'night' ? 'light' : 'night';
		root.dataset.theme = next;
		try {
			localStorage.setItem('theme', next);
		} catch {
			/* private mode: toggle still works for this page view */
		}
	}
</script>

<svelte:window onpointerup={onPointerUp} />
