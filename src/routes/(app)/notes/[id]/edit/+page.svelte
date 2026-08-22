<script lang="ts">
	import 'katex/dist/katex.min.css';
	import { resolve } from '$app/paths';
	import { beforeNavigate } from '$app/navigation';
	import { formatDateTime } from '$lib/helpers';

	let { data } = $props();

	/**
	 * The editor's source of truth is this string. It is plain markdown text —
	 * deliberately NOT a rich document model — so nothing here can rewrite or
	 * mangle what the nvim plugin synced. The preview is a pure function of it.
	 *
	 * Seeded from `data` on purpose (hence the state_referenced_locally suppressions):
	 * this is the draft buffer, and a later reload of `data` must NOT clobber what
	 * the author has typed since.
	 */
	// svelte-ignore state_referenced_locally
	let content = $state(data.note.content);
	/** The last text we know the server has, used to decide if a save is needed. */
	// svelte-ignore state_referenced_locally
	let savedContent = $state(data.note.content);
	// svelte-ignore state_referenced_locally
	let title = $state(data.note.title);

	let textarea: HTMLTextAreaElement | undefined = $state();
	let previewEl: HTMLElement | undefined = $state();

	let dirty = $derived(content !== savedContent);

	type SaveState = 'idle' | 'saving' | 'saved' | 'error';
	let saveState = $state<SaveState>('idle');
	let saveError = $state<string | null>(null);
	let lastSavedAt = $state<Date | null>(null);

	let previewHtml = $state('');
	let previewError = $state<string | null>(null);
	let rendering = $state(false);

	let uploading = $state(0);
	let uploadError = $state<string | null>(null);
	let dragOver = $state(false);

	/** Live preview vs. raw HTML source of the rendered output. */
	let showSource = $state(false);
	/** On narrow screens the panes stack; this picks which one is showing. */
	let mobilePane = $state<'write' | 'preview'>('write');

	const AUTOSAVE_MS = 1500;
	const PREVIEW_MS = 250;

	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let previewTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Serialise saves. Two debounced saves could otherwise overlap and land out of
	 * order, letting an older body win. While one is in flight we mark that another
	 * is wanted and fire it on completion.
	 */
	let saveInFlight = false;
	let saveQueued = false;

	async function save({ silent }: { silent: boolean }) {
		if (data.locked) return;
		if (saveInFlight) {
			saveQueued = true;
			return;
		}
		// Snapshot what we're about to persist: `content` can change mid-request.
		const body = content;
		if (body === savedContent && silent) return;

		saveInFlight = true;
		saveState = 'saving';
		saveError = null;

		try {
			// ?silent=true skips the note_versions row for autosaves so the history
			// stays meaningful revisions rather than keystroke snapshots. An explicit
			// save (Cmd+S / Save button) omits it and does create a version.
			const res = await fetch(`/api/notes/${data.note.publicId}${silent ? '?silent=true' : ''}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: body })
			});

			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				throw new Error(payload.error || `Save failed (${res.status})`);
			}

			const updated = await res.json();
			savedContent = body;
			// The server re-reads `title:` from frontmatter on every update, so the
			// heading follows what the document actually declares.
			if (updated?.title) title = updated.title;
			lastSavedAt = new Date();
			saveState = 'saved';
		} catch (e) {
			saveState = 'error';
			saveError = e instanceof Error ? e.message : 'Save failed';
		} finally {
			saveInFlight = false;
			if (saveQueued) {
				saveQueued = false;
				void save({ silent: true });
			}
		}
	}

	async function renderPreview() {
		const body = content;
		rendering = true;
		try {
			// Rendered server-side through the SAME chain as the published page, so
			// the preview can't drift from what readers will see.
			const res = await fetch(`/api/notes/${data.note.publicId}/preview`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: body })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				// 422 is an expected state while typing (e.g. a half-written frontmatter
				// fence). Keep the last good HTML on screen and show the reason.
				previewError = payload.error || `Preview failed (${res.status})`;
				return;
			}
			previewHtml = payload.html ?? '';
			previewError = null;
		} catch (e) {
			previewError = e instanceof Error ? e.message : 'Preview failed';
		} finally {
			rendering = false;
		}
	}

	/**
	 * Drive both debounces off content changes. Reading `content` is what
	 * subscribes this effect; the timers are cleared on re-run so only the last
	 * keystroke in a burst schedules work.
	 */
	$effect(() => {
		void content;

		clearTimeout(previewTimer);
		previewTimer = setTimeout(renderPreview, PREVIEW_MS);

		if (!data.locked && content !== savedContent) {
			clearTimeout(saveTimer);
			saveTimer = setTimeout(() => void save({ silent: true }), AUTOSAVE_MS);
		}

		return () => {
			clearTimeout(previewTimer);
			clearTimeout(saveTimer);
		};
	});

	// First paint: render what we loaded.
	$effect(() => {
		void renderPreview();
	});

	/** Warn before losing unsaved text — both in-app and on tab close. */
	beforeNavigate(({ cancel }) => {
		if (!dirty) return;
		if (!confirm('You have unsaved changes. Leave anyway?')) cancel();
	});

	$effect(() => {
		if (!dirty) return;
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			// Required for Chrome to show the native prompt.
			e.returnValue = '';
		};
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	function onKeydown(e: KeyboardEvent) {
		// Cmd/Ctrl+S — explicit save, which DOES create a version.
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			clearTimeout(saveTimer);
			void save({ silent: false });
			return;
		}
		// Tab indents instead of leaving the textarea — this is a code-ish surface.
		if (e.key === 'Tab' && textarea) {
			e.preventDefault();
			insertAtCursor('\t');
		}
	}

	/** Replace the selection with `text`, then restore a sensible caret. */
	function insertAtCursor(text: string, selectInserted = false) {
		if (!textarea) {
			content += text;
			return;
		}
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		content = content.slice(0, start) + text + content.slice(end);
		const caret = selectInserted ? start : start + text.length;
		const caretEnd = start + text.length;
		// Wait for the bound value to flush before moving the caret.
		requestAnimationFrame(() => {
			textarea?.focus();
			textarea?.setSelectionRange(caret, caretEnd);
		});
	}

	/**
	 * Wrap the selection in `before`/`after` (bold, italic, code). With nothing
	 * selected, insert the markers and place the caret between them.
	 */
	function wrapSelection(before: string, after = before) {
		if (!textarea) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const selected = content.slice(start, end);
		content = content.slice(0, start) + before + selected + after + content.slice(end);
		const caret = start + before.length;
		requestAnimationFrame(() => {
			textarea?.focus();
			textarea?.setSelectionRange(caret, caret + selected.length);
		});
	}

	/** Prefix every line of the selection (lists, quotes, headings). */
	function prefixLines(prefix: string) {
		if (!textarea) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const lineStart = content.lastIndexOf('\n', start - 1) + 1;
		const lineEnd = content.indexOf('\n', end) === -1 ? content.length : content.indexOf('\n', end);
		const block = content.slice(lineStart, lineEnd);
		const prefixed = block
			.split('\n')
			.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l))
			.join('\n');
		content = content.slice(0, lineStart) + prefixed + content.slice(lineEnd);
		requestAnimationFrame(() => {
			textarea?.focus();
			textarea?.setSelectionRange(lineStart, lineStart + prefixed.length);
		});
	}

	/**
	 * Upload one file and insert a reference at the caret.
	 *
	 * The endpoint returns an absolute R2 URL and we insert that directly, rather
	 * than a local filename resolved via imageMap — an absolute URL needs no map
	 * entry, so a paste can never race an in-flight autosave into a broken image.
	 */
	async function uploadAndInsert(file: File) {
		uploading++;
		uploadError = null;
		// A placeholder marks the spot so the caret can move on while bytes upload.
		const token = `![uploading ${file.name}…]()`;
		insertAtCursor(token);

		try {
			const form = new FormData();
			form.append('file', file);
			const res = await fetch(`/api/notes/${data.note.publicId}/assets`, {
				method: 'POST',
				body: form
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || `Upload failed (${res.status})`);

			// Video renders as <video> by the shared renderer when the path ends in a
			// video extension, so image syntax is correct for both kinds.
			const alt = payload.kind === 'video' ? 'video' : file.name.replace(/\.[^.]+$/, '');
			const markdown = `![${alt}](${payload.url})`;
			content = content.replace(token, markdown);
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Upload failed';
			// Leave no dead placeholder behind.
			content = content.replace(token, '');
		} finally {
			uploading--;
		}
	}

	function filesFrom(list: FileList | null | undefined): File[] {
		if (!list) return [];
		return Array.from(list).filter(
			(f) => f.type.startsWith('image/') || f.type.startsWith('video/')
		);
	}

	function onPaste(e: ClipboardEvent) {
		if (data.locked) return;
		const files = filesFrom(e.clipboardData?.files);
		if (files.length === 0) return; // plain text paste — let the browser handle it
		e.preventDefault();
		for (const f of files) void uploadAndInsert(f);
	}

	function onDrop(e: DragEvent) {
		dragOver = false;
		if (data.locked) return;
		const files = filesFrom(e.dataTransfer?.files);
		if (files.length === 0) return;
		e.preventDefault();
		for (const f of files) void uploadAndInsert(f);
	}

	function pickFiles() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*,video/*';
		input.multiple = true;
		input.onchange = () => {
			for (const f of filesFrom(input.files)) void uploadAndInsert(f);
		};
		input.click();
	}

	/** Keep the preview roughly aligned with the caret as you scroll the source. */
	function syncScroll() {
		if (!textarea || !previewEl) return;
		const max = textarea.scrollHeight - textarea.clientHeight;
		if (max <= 0) return;
		const ratio = textarea.scrollTop / max;
		previewEl.scrollTop = ratio * (previewEl.scrollHeight - previewEl.clientHeight);
	}

	let statusText = $derived.by(() => {
		if (data.locked) return 'Signed — read only';
		if (saveState === 'saving') return 'Saving…';
		if (saveState === 'error') return saveError ?? 'Save failed';
		if (dirty) return 'Unsaved changes';
		if (lastSavedAt) return `Saved ${formatDateTime(lastSavedAt)}`;
		return 'Up to date';
	});

	let wordCount = $derived(content.trim() ? content.trim().split(/\s+/).length : 0);
</script>

<svelte:head>
	<title>{title || 'Untitled'} — Edit</title>
</svelte:head>

<svelte:window on:keydown={onKeydown} />

<div class="flex h-[calc(100vh-4rem)] flex-col">
	<!-- Header: identity, status, actions -->
	<header class="flex flex-wrap items-center gap-2 border-b border-base-300 px-4 py-2">
		<a href={resolve('/(app)/notes')} class="btn btn-ghost btn-sm" aria-label="Back to notes">←</a>

		<div class="min-w-0 flex-1">
			<h1 class="truncate text-sm font-semibold">{title || 'Untitled'}</h1>
			<p class="text-xs text-base-content/60">
				<span
					class:text-error={saveState === 'error'}
					class:text-warning={dirty && saveState !== 'error'}>{statusText}</span
				>
				<span class="mx-1">·</span>v{data.note.version}
				<span class="mx-1">·</span>{wordCount} words
				{#if uploading > 0}
					<span class="mx-1">·</span><span class="text-info"
						>Uploading {uploading} file{uploading === 1 ? '' : 's'}…</span
					>
				{/if}
			</p>
		</div>

		<!-- Pane switch (small screens only) -->
		<div class="join lg:hidden">
			<button
				class="btn join-item btn-sm"
				class:btn-active={mobilePane === 'write'}
				onclick={() => (mobilePane = 'write')}>Write</button
			>
			<button
				class="btn join-item btn-sm"
				class:btn-active={mobilePane === 'preview'}
				onclick={() => (mobilePane = 'preview')}>Preview</button
			>
		</div>

		<a
			href={resolve('/(public)/[id]', { id: data.note.publicId })}
			target="_blank"
			rel="noopener"
			class="btn btn-ghost btn-sm">View</a
		>
		<button
			class="btn btn-primary btn-sm"
			disabled={data.locked || saveState === 'saving' || !dirty}
			onclick={() => {
				clearTimeout(saveTimer);
				void save({ silent: false });
			}}
		>
			{saveState === 'saving' ? 'Saving…' : 'Save version'}
		</button>
	</header>

	{#if data.locked}
		<div role="alert" class="alert alert-warning m-3 py-2">
			<span class="text-sm">
				This document has been signed, so its text is locked to preserve what the signers agreed to.
				Duplicate it to make a new version.
			</span>
		</div>
	{/if}

	{#if saveState === 'error' && saveError}
		<div role="alert" class="alert alert-error m-3 py-2">
			<span class="text-sm">{saveError}</span>
			<button class="btn btn-ghost btn-xs" onclick={() => void save({ silent: false })}
				>Retry</button
			>
		</div>
	{/if}

	{#if uploadError}
		<div role="alert" class="alert alert-error m-3 py-2">
			<span class="text-sm">{uploadError}</span>
			<button class="btn btn-ghost btn-xs" onclick={() => (uploadError = null)}>Dismiss</button>
		</div>
	{/if}

	<!-- Formatting toolbar -->
	{#if !data.locked}
		<div class="flex flex-wrap items-center gap-1 border-b border-base-300 px-3 py-1.5">
			<button
				class="btn btn-ghost btn-xs font-bold"
				title="Bold (**)"
				onclick={() => wrapSelection('**')}>B</button
			>
			<button
				class="btn btn-ghost btn-xs italic"
				title="Italic (_)"
				onclick={() => wrapSelection('_')}>I</button
			>
			<button
				class="btn btn-ghost btn-xs font-mono"
				title="Inline code (`)"
				onclick={() => wrapSelection('`')}>&lt;/&gt;</button
			>
			<div class="mx-1 h-4 w-px bg-base-300"></div>
			<button class="btn btn-ghost btn-xs" title="Heading" onclick={() => prefixLines('## ')}
				>H2</button
			>
			<button class="btn btn-ghost btn-xs" title="Bullet list" onclick={() => prefixLines('- ')}
				>List</button
			>
			<button class="btn btn-ghost btn-xs" title="Quote" onclick={() => prefixLines('> ')}
				>Quote</button
			>
			<button
				class="btn btn-ghost btn-xs"
				title="Code block"
				onclick={() => insertAtCursor('\n```\n\n```\n')}>Block</button
			>
			<button class="btn btn-ghost btn-xs" title="Link" onclick={() => wrapSelection('[', '](url)')}
				>Link</button
			>
			<div class="mx-1 h-4 w-px bg-base-300"></div>
			<button class="btn btn-ghost btn-xs" title="Upload image or video" onclick={pickFiles}>
				Upload
			</button>
			<span class="ml-auto text-xs text-base-content/50">
				Paste or drop images and video · ⌘S to save a version
			</span>
		</div>
	{/if}

	<!-- Panes -->
	<div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
		<!-- Source -->
		<!--
			role="group" satisfies the a11y rule for a drag/drop container. The drop
			handler is a convenience only: the same upload is always reachable from the
			toolbar's Upload button and from paste, both of which are keyboard-usable.
		-->
		<section
			role="group"
			aria-label="Markdown source"
			class="relative min-h-0 border-base-300 lg:block lg:border-r"
			class:hidden={mobilePane !== 'write'}
			ondragover={(e) => {
				e.preventDefault();
				dragOver = true;
			}}
			ondragleave={() => (dragOver = false)}
			ondrop={onDrop}
		>
			<textarea
				bind:this={textarea}
				bind:value={content}
				onpaste={onPaste}
				onscroll={syncScroll}
				readonly={data.locked}
				spellcheck="false"
				placeholder="# Start writing — markdown on the left, preview on the right."
				class="h-full w-full resize-none border-0 bg-base-100 p-4 font-mono text-sm leading-relaxed text-base-content focus:outline-none"
				class:opacity-60={data.locked}></textarea>

			{#if dragOver && !data.locked}
				<div
					class="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10"
				>
					<span class="text-sm font-medium text-primary">Drop to upload</span>
				</div>
			{/if}
		</section>

		<!-- Preview -->
		<section
			class="flex min-h-0 flex-col overflow-hidden bg-base-100 lg:flex"
			class:hidden={mobilePane !== 'preview'}
		>
			<div class="flex items-center gap-2 border-b border-base-300 px-3 py-1">
				<span class="text-xs font-medium text-base-content/60">
					Preview {rendering ? '· rendering…' : ''}
				</span>
				<label class="ml-auto flex cursor-pointer items-center gap-1 text-xs">
					<input type="checkbox" class="toggle toggle-xs" bind:checked={showSource} />
					HTML
				</label>
			</div>

			{#if previewError}
				<div role="alert" class="alert alert-warning m-3 py-2">
					<span class="text-xs">{previewError}</span>
				</div>
			{/if}

			<div bind:this={previewEl} class="min-h-0 flex-1 overflow-y-auto p-4 pb-24">
				{#if showSource}
					<pre class="overflow-x-auto text-xs text-base-content"><code>{previewHtml}</code></pre>
				{:else}
					<!--
						Rendered by our own server-side pipeline from the author's own
						markdown, matching how the published page injects it.
					-->
					<article
						class="prose max-w-none text-base-content [overflow-wrap:anywhere] [--tw-prose-body:var(--color-base-content)] [--tw-prose-headings:var(--color-base-content)] [--tw-prose-bold:var(--color-base-content)] [--tw-prose-links:var(--color-primary)] [--tw-prose-quotes:var(--color-base-content)] [--tw-prose-code:var(--color-base-content)] [--tw-prose-captions:var(--color-base-content)] [--tw-prose-counters:var(--color-base-content)] [--tw-prose-bullets:var(--color-base-content)] [--tw-prose-hr:var(--color-base-300)] [--tw-prose-quote-borders:var(--color-base-300)] [--tw-prose-th-borders:var(--color-base-300)] [--tw-prose-td-borders:var(--color-base-300)] [&_pre]:border [&_pre]:border-base-300 [&_pre]:bg-base-200 [&_pre]:text-base-content [&_pre_code]:bg-transparent [&_pre_code]:text-base-content [&_code]:[overflow-wrap:anywhere] [&_img]:max-w-full [&_video]:max-w-full [&_pre]:overflow-x-auto [&_pre]:[overflow-wrap:normal] [&_table]:block [&_table]:w-full [&_table]:max-w-full [&_table]:overflow-x-auto [&_th]:whitespace-normal [&_td]:whitespace-normal"
					>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html previewHtml}
					</article>
				{/if}
			</div>
		</section>
	</div>
</div>

<style>
	/* KaTeX display math can overflow the narrower preview pane. */
	:global(.prose .katex-display) {
		overflow-x: auto;
		overflow-y: hidden;
	}
</style>
