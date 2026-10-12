<script lang="ts">
	import Icon from '@iconify/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Logo from '#lib/components/Logo.svelte';

	let { redirectTo = '/account' }: { redirectTo?: string } = $props();

	let isOtpStep = $state(false);
	// let email = 'l@sshawn.com';
	let email = $state('');
	let otp = $state(['', '', '', '', '', '']);
	// let otp = [5, 5, 0, 4, 4, 8];
	let errorMessage = $state('');

	const validEmail = $derived(email && /^[\w.-]+@([\w-]+\.)+[\w-]{2,4}$/g.test(email));

	let isLoading = $state(false);
	let success = $state(false);

	let redirectingToSocialLogin = $state('');
	function socialLogin(provider: string) {
		redirectingToSocialLogin = provider;
		const q = `?redirectTo=${encodeURIComponent(redirectTo)}`;
		switch (provider) {
			case 'github':
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				goto(`${resolve('login/github')}${q}`);
				break;
			case 'google':
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				goto(`${resolve('login/google')}${q}`);
				break;
			default:
				console.error('Unknown provider:', provider);
				redirectingToSocialLogin = '';
		}
	}

	onMount(() => {
		const urlParams = new URLSearchParams(window.location.search);
		const step = urlParams.get('step');

		if (step === 'otp') {
			isOtpStep = true;
			const storedEmail = sessionStorage.getItem('userEmail');
			if (storedEmail) {
				email = storedEmail;
			}
		} else {
			// For the email step, still try to retrieve stored email
			const storedEmail = sessionStorage.getItem('userEmail');
			if (storedEmail) {
				email = storedEmail;
			}
		}
	});

	async function loginWithOtp() {
		isLoading = true;
		errorMessage = '';
		const res = await fetch(`api/auth/login-with-otp`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ email, otp: otp.join('') })
		});
		const data = await res.json();
		if (data.errorMessage) {
			errorMessage = data.errorMessage;
		} else {
			success = true;
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(redirectTo, { replace: true, refreshAll: true });
		}

		isLoading = false;
	}

	async function requestOtp(event) {
		event.preventDefault();
		email = email.toLowerCase();
		isLoading = true;
		errorMessage = '';
		const res = await fetch(`api/auth/request-otp`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ email })
		});
		if (res.status !== 200) {
			const resData = await res.json();
			errorMessage = resData.errorMessage;
		} else {
			isOtpStep = true;
			// Save email to sessionStorage
			sessionStorage.setItem('userEmail', email);
			// Update URL without exposing email
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`${resolve('login')}?step=otp`, { shallow: true, replace: true });
		}
		isLoading = false;
	}

	async function backFromOtp() {
		errorMessage = '';
		isOtpStep = false;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`${resolve('login')}?step=email`, { shallow: true, replace: true });
	}

	// Function to focus next input on keyup
	function handleInput(event, index) {
		const value = parseInt(event.target.value);

		if (isNaN(value)) {
			otp[index] = '';
			return;
		}

		const valueStr = value.toString();
		if (valueStr.length > 1) {
			otp[index] = parseInt(valueStr.slice(-1));
		} else {
			otp[index] = value;
		}

		if (value >= 0 && index < otp.length - 1) {
			event.target.nextElementSibling.focus();
		}
	}

	function handlePaste(event) {
		event.preventDefault();
		const paste = event.clipboardData.getData('text');
		const numbers = paste.split('').filter((char) => !isNaN(char) && char.trim() !== '');

		otp = otp.map((_, index) => {
			return index < numbers.length && !isNaN(numbers[index]) ? numbers[index] : '';
		});

		const lastNumberIndex = numbers.length - 1;
		const nextInputIndex = lastNumberIndex + 1 < otp.length ? lastNumberIndex + 1 : lastNumberIndex;
		if (event.target.form[nextInputIndex]) event.target.form[nextInputIndex].focus();
	}

	function handleKeydown(event, index) {
		if (event.key === 'Backspace' && event.target.value === '' && index > 0) {
			otp[index - 1] = '';
			event.target.previousElementSibling.focus();
		} else if (event.key === 'Enter') {
			if (otp.every((digit) => !!digit)) {
				loginWithOtp();
			}
		}
	}
</script>

<div class="w-full max-w-sm">
	<a
		href={resolve('/(public)')}
		class="mx-auto block w-fit text-base-content"
		aria-label="mdpubs home"
	>
		<Logo class="h-14 w-auto" />
	</a>

	<h1 class="mt-10 text-center text-2xl font-semibold tracking-tight">
		{isOtpStep ? 'Check your email' : 'Sign in to mdpubs'}
	</h1>
	<p class="mt-2 text-center text-sm text-base-content/60">
		{#if isOtpStep}
			We sent a 6-digit code to <span class="font-medium text-base-content">{email}</span>
		{:else}
			We'll email you a code. No password.
		{/if}
	</p>

	{#if !isOtpStep}
		<form class="mt-8" onsubmit={requestOtp}>
			<label class="sr-only" for="email">Email</label>
			<input
				class="input w-full"
				id="email"
				name="email"
				autofocus
				placeholder="you@company.com"
				type="email"
				bind:value={email}
				autocapitalize="none"
				autocomplete="email"
				autocorrect="off"
				disabled={isLoading}
			/>
			<button
				type="submit"
				disabled={isLoading || !validEmail}
				class="btn mt-3 btn-block btn-neutral"
			>
				{#if isLoading && !redirectingToSocialLogin}
					<span class="loading loading-sm loading-spinner"></span>
				{/if}
				Continue with email
			</button>
			{#if errorMessage}
				<p class="mt-3 text-sm text-error">{errorMessage}</p>
			{/if}
		</form>

		<div class="divider my-6 text-xs text-base-content/40">or</div>

		<button
			class="btn btn-block btn-outline"
			onclick={() => socialLogin('github')}
			class:btn-disabled={redirectingToSocialLogin}
		>
			{#if redirectingToSocialLogin === 'github'}
				<span class="loading loading-sm loading-spinner"></span>
			{:else}
				<Icon icon="mdi:github" class="h-5 w-5" />
			{/if}
			Continue with GitHub
		</button>
	{:else}
		<form class="mt-8" onsubmit={(e) => e.preventDefault()}>
			<div class="flex justify-center gap-2">
				<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
				{#each otp as _value, index (index)}
					<input
						inputmode="numeric"
						autofocus={index === 0}
						type="text"
						maxlength="1"
						pattern="\d*"
						aria-label={`Digit ${index + 1}`}
						class="input h-12 w-11 px-0 text-center font-mono text-lg"
						bind:value={otp[index]}
						oninput={(event) => handleInput(event, index)}
						onpaste={handlePaste}
						onfocus={(e) => e.target.select()}
						onkeydown={(event) => handleKeydown(event, index)}
						id={`otp-input-${index}`}
					/>
				{/each}
			</div>
			<button
				type="button"
				disabled={isLoading || otp.some((v) => v === '')}
				class="btn mt-6 btn-block {success ? 'btn-success' : 'btn-neutral'}"
				onclick={() => loginWithOtp()}
			>
				{#if isLoading}
					<span class="loading loading-sm loading-spinner"></span>
				{:else}
					{success ? 'Signing in…' : 'Sign in'}
				{/if}
			</button>
			{#if errorMessage}
				<p class="mt-3 text-center text-sm text-error">{errorMessage}</p>
			{/if}
		</form>

		<button
			type="button"
			class="mx-auto mt-6 block text-sm text-base-content/60 underline-offset-4 hover:underline"
			onclick={() => backFromOtp()}
		>
			Use a different email
		</button>
	{/if}
</div>
