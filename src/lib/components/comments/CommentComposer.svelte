<script lang="ts" module>
	/** Who a guest says they are, kept in this browser so we only ask once. */
	export type Commenter = { name: string; email: string; key: string };

	const STORE = 'mdpubs:commenter';

	export function loadCommenter(): Commenter {
		try {
			const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
			if (saved && typeof saved.key === 'string') {
				return { name: saved.name || '', email: saved.email || '', key: saved.key };
			}
		} catch {
			// Private window or blocked storage: carry on without remembering.
		}
		const bytes = crypto.getRandomValues(new Uint8Array(24));
		const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
		// Saved straight away so every composer on the page signs with the same key.
		const fresh = { name: '', email: '', key };
		saveCommenter(fresh);
		return fresh;
	}

	/** The saved key, without making one. Sent with reads so a guest's own comments come back marked. */
	export function commenterKey(): string | null {
		try {
			const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
			return typeof saved?.key === 'string' ? saved.key : null;
		} catch {
			return null;
		}
	}

	function saveCommenter(c: Commenter) {
		try {
			localStorage.setItem(STORE, JSON.stringify(c));
		} catch {
			// Nothing to do: they will be asked again next time.
		}
	}
</script>

<script lang="ts">
	type Props = {
		/** The signed-in viewer's name, or null for a guest. */
		viewerName: string | null;
		email: 'optional' | 'required' | 'off';
		placeholder?: string;
		focus?: boolean;
		onsubmit: (input: {
			body: string;
			name?: string;
			email?: string;
			key?: string;
			website?: string;
		}) => Promise<string | null>;
		oncancel: () => void;
	};
	let {
		viewerName,
		email,
		placeholder = 'Add a comment',
		focus = true,
		onsubmit,
		oncancel
	}: Props = $props();

	const who = loadCommenter();
	let name = $state(who.name);
	let mail = $state(who.email);
	// Ask for a name until one is saved; after that, only when they choose to change it.
	let editingWho = $state(!who.name);
	let body = $state('');
	let website = $state('');
	let sending = $state(false);
	let error = $state('');

	const guest = $derived(viewerName === null);
	const ready = $derived(
		!!body.trim() && (!guest || (!!name.trim() && (email !== 'required' || !!mail.trim())))
	);

	async function send() {
		if (!ready || sending) return;
		sending = true;
		error = '';
		const input = guest
			? { body, name: name.trim(), email: mail.trim(), key: who.key, website }
			: { body };
		const problem = await onsubmit(input);
		sending = false;
		if (problem) {
			error = problem;
			return;
		}
		if (guest) saveCommenter({ name: name.trim(), email: mail.trim(), key: who.key });
		body = '';
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			send();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
		}
	}

	function autofocus(node: HTMLElement) {
		if (focus) node.focus({ preventScroll: true });
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mc-composer" {onkeydown}>
	{#if guest && editingWho}
		<input
			class="mc-field"
			type="text"
			placeholder="Your name"
			maxlength="60"
			autocomplete="name"
			bind:value={name}
			{@attach (node) => {
				if (!name) autofocus(node);
			}}
		/>
		{#if email !== 'off'}
			<input
				class="mc-field"
				type="email"
				placeholder={email === 'required' ? 'Email' : 'Email (optional)'}
				maxlength="200"
				autocomplete="email"
				bind:value={mail}
			/>
		{/if}
	{/if}
	<!-- Bots fill this in; people never see it. -->
	<input
		class="mc-trap"
		type="text"
		tabindex="-1"
		autocomplete="off"
		aria-hidden="true"
		bind:value={website}
	/>
	<textarea
		class="mc-field"
		rows="3"
		maxlength="4000"
		{placeholder}
		bind:value={body}
		{@attach (node) => {
			if (!guest || name) autofocus(node);
		}}></textarea>
	{#if error}
		<p class="mc-error">{error}</p>
	{/if}
	<div class="mc-row">
		<span class="mc-who">
			{#if !guest}
				<span class="mc-name">as {viewerName}</span>
			{:else if !editingWho}
				<span class="mc-name">as {name}</span>
				<button type="button" onclick={() => (editingWho = true)}>change</button>
			{:else if email !== 'off'}
				<span class="mc-name">Email stays private</span>
			{/if}
		</span>
		<button type="button" class="mc-quiet" onclick={oncancel}>Cancel</button>
		<button type="button" class="mc-send" disabled={!ready || sending} onclick={send}>
			{sending ? 'Posting' : 'Comment'}
		</button>
	</div>
</div>

<style>
	.mc-composer {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		width: 100%;
		padding: 0.5rem;
		border-radius: 0.75rem;
		background: var(--color-base-100);
		box-shadow:
			0 4px 20px color-mix(in oklch, var(--color-base-content) 10%, transparent),
			inset 0 0 0 1px color-mix(in oklch, var(--color-base-content) 8%, transparent);
		font-family: inherit;
		text-align: left;
	}
	.mc-field {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid color-mix(in oklch, var(--color-base-content) 12%, transparent);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-base-content);
		/* 16px keeps iOS from zooming the page when the field is focused. */
		font-size: 1rem;
		line-height: 1.35;
		outline: none;
		resize: vertical;
	}
	@media (min-width: 640px) {
		.mc-field {
			font-size: 0.8125rem;
		}
	}
	.mc-field:focus {
		border-color: #3c82f7;
	}
	.mc-trap {
		position: absolute;
		left: -9999px;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.mc-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
	}
	.mc-who {
		display: flex;
		flex: 1;
		gap: 0.3rem;
		min-width: 0;
		color: color-mix(in oklch, var(--color-base-content) 45%, transparent);
	}
	/* A long name is cut short; "change" beside it always stays in reach. */
	.mc-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mc-who button {
		flex: none;
		text-decoration: underline;
		cursor: pointer;
	}
	.mc-quiet {
		color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
		cursor: pointer;
	}
	.mc-send {
		padding: 0.25rem 0.625rem;
		border-radius: 999px;
		background: var(--color-base-content);
		color: var(--color-base-100);
		font-weight: 500;
		cursor: pointer;
	}
	.mc-send:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.mc-error {
		font-size: 0.75rem;
		color: var(--color-error);
	}
</style>
