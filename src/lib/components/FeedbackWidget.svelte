<script lang="ts">
	import { page } from '$app/state';
	import { Send, X } from 'lucide-svelte';
	import { scale } from 'svelte/transition';

	let isOpen = $state(false);
	let message = $state('');
	let email = $state(page.data.user?.email ?? '');
	let name = $state('');
	let status: 'idle' | 'submitting' | 'success' | 'error' = $state('idle');
	let errorMessage = $state('');

	function toggle() {
		isOpen = !isOpen;
		if (!isOpen) {
			resetForm();
		}
	}

	function resetForm() {
		message = '';
		email = '';
		name = '';
		status = 'idle';
		errorMessage = '';
	}

	async function handleSubmit() {
		if (message.trim() === '') {
			errorMessage = 'Please enter a message.';
			status = 'error';
			return;
		}

		if (!email.trim()) {
			errorMessage = 'Please enter your email.';
			status = 'error';
			return;
		}

		// basic email validation
		if (!/^\S+@\S+\.\S+$/.test(email)) {
			errorMessage = 'Please enter a valid email address.';
			status = 'error';
			return;
		}

		status = 'submitting';
		errorMessage = '';

		try {
			const res = await fetch('/api/feedback', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					message,
					email,
					page: page.url.pathname,
					metadata: name ? { id: page.data?.user?.id, name } : undefined
				})
			});

			if (res.ok) {
				status = 'success';
				setTimeout(() => {
					isOpen = false;
					resetForm();
				}, 2000);
			} else {
				const data = await res.json();
				errorMessage = data.message || 'An unexpected error occurred.';
				status = 'error';
			}
		} catch (e) {
			errorMessage = 'Failed to submit feedback. Please try again later.';
			status = 'error';
		}
	}
</script>

<div class="fixed right-4 bottom-4 z-50 flex flex-col items-end">
	{#if isOpen}
		<div
			class="bg-base-100 mb-2 w-80 rounded-lg border p-4 shadow-lg sm:w-96"
			transition:scale={{ duration: 150, start: 0.95 }}
		>
			{#if status === 'success'}
				<div class="flex h-full flex-col items-center justify-center py-10">
					<h3 class="text-lg font-semibold">Thank you!</h3>
					<p>Your feedback has been received.</p>
				</div>
			{:else}
				<div>
					<h3 class="mb-2 text-lg font-semibold">Give us your feedback</h3>
					<textarea
						bind:value={message}
						class="textarea textarea-bordered w-full"
						rows="4"
						placeholder="Your message..."
						disabled={status === 'submitting'}
						aria-label="Your message"
					></textarea>

					<input
						type="email"
						bind:value={email}
						placeholder="Your email"
						class="input input-bordered mt-2 w-full"
						disabled={status === 'submitting'}
						aria-label="Your email"
					/>
					<input
						type="text"
						bind:value={name}
						placeholder="Your name (optional)"
						class="input input-bordered mt-2 w-full"
						disabled={status === 'submitting'}
						aria-label="Your name (optional)"
					/>

					{#if status === 'error' && errorMessage}
						<p class="text-error mt-2 text-sm">{errorMessage}</p>
					{/if}

					<div class="mt-4 flex justify-end">
						<button
							class="btn btn-primary"
							onclick={handleSubmit}
							disabled={status === 'submitting' || !message.trim()}
						>
							{#if status === 'submitting'}
								<span class="loading loading-spinner"></span>
							{/if}
							Send
							<Send class="ml-2 h-4 w-4" />
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<button
		class="btn btn-primary btn-sm shadow-lg"
		onclick={toggle}
		aria-label={isOpen ? 'Close feedback form' : 'Open feedback form'}
	>
		{#if isOpen}
			<X class="h-4 w-4" />
		{:else}
			Feedback
		{/if}
	</button>
</div>
