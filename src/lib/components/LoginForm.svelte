<script lang="ts">
	import Icon from '@iconify/svelte';
	import { goto, replaceState } from '$app/navigation';
	import { onMount } from 'svelte';

	let isOtpStep = $state(false);
	// let email = 'l@sshawn.com';
	let email = $state('');
	let otp = $state(['', '', '', '', '', '']);
	// let otp = [5, 5, 0, 4, 4, 8];
	let errorMessage = $state('');

	const validEmail = $derived(email && /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/g.test(email));

	let isLoading = $state(false);
	let success = $state(false);

	let redirectingToSocialLogin = $state('');
	function socialLogin(provider: string) {
		redirectingToSocialLogin = provider;
		switch (provider) {
			case 'github':
				goto('/login/github');
				break;
			case 'google':
				goto('/login/google');
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
			goto('/account', { replaceState: true, invalidateAll: true });
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
			replaceState(`?step=otp`, {});
		}
		isLoading = false;
	}

	async function backFromOtp() {
		errorMessage = '';
		isOtpStep = false;
		replaceState('?step=email', {});
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
		event.target.form[nextInputIndex] && event.target.form[nextInputIndex].focus();
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

<div class="mx-auto w-full p-6 md:w-auto md:min-w-[300px]">
	<h1 class="flex w-full items-center justify-between text-4xl font-semibold tracking-tight">
		{#if isOtpStep}
			<button onclick={() => backFromOtp()} class="btn-ghost btn btn-circle">
				<Icon icon="mdi:chevron-left" style="font-size: 2rem;" />
			</button>
		{:else}
			<!-- This empty div ensures the text in the center div remains centered -->
			<div />
		{/if}

		<div class="flex-1 text-center text-2xl">
			{isOtpStep ? 'Enter OTP' : 'Sign In'}
		</div>

		<!-- This empty div is a spacer for balancing the layout -->
		<div />
		{#if isOtpStep}
			<!-- Invisible spacer for symmetry -->
			<div class="invisible">
				<button class="btn-ghost btn">
					<Icon icon="mdi:chevron-left" style="font-size: 2rem;" />
				</button>
			</div>
		{/if}
	</h1>

	<p class="text-muted-foreground mt-4 mb-4 text-center text-sm">
		{isOtpStep ? `Enter the OTP sent to ${email}` : 'Enter your email to continue'}
	</p>
	<div class="flex flex-col">
		<div>
			{#if !isOtpStep}
				<form onsubmit={requestOtp}>
					<!-- <Label -->
					<!-- 	class="sr-only" -->
					<!-- 	for="email">Email</Label -->
					<!-- > -->
					<input
						class="input-bordered input-primary input bg-base-100 w-full rounded-xs"
						id="email"
						name="email"
						autofocus
						placeholder="Your email..."
						type="email"
						bind:value={email}
						autocapitalize="none"
						autocomplete="email"
						autocorrect="off"
						disabled={isLoading}
					/>
					<button
						disabled={isLoading || !validEmail}
						class="btn-primary btn btn-block btn-md mt-6 rounded-md"
						onclick={requestOtp}
					>
						{#if isLoading && !redirectingToSocialLogin}
							<span class="loading loading-spinner loading-md"></span>
						{/if}
						Request OTP
					</button>
					<div class="mt-4 text-red-500">{errorMessage}</div>
				</form>
				<div class="text-center">
					<div class="my-4">or</div>
					<!-- <button -->
					<!-- 	class="btn btn-outline btn-block" -->
					<!-- 	onclick={() => socialLogin('google')} -->
					<!-- 	class:btn-disabled={redirectingToSocialLogin} -->
					<!-- > -->
					<!-- 	{#if redirectingToSocialLogin === 'google'} -->
					<!-- 		<span class="loading loading-spinner loading-md"></span> -->
					<!-- 	{/if} -->
					<!-- 	<Icon icon="ph:google-logo-bold" /> -->
					<!-- 	Sign in with Google</button -->
					<!-- > -->
					<button
						class="btn btn-outline btn-block mt-4"
						onclick={() => socialLogin('github')}
						class:btn-disabled={redirectingToSocialLogin}
					>
						{#if redirectingToSocialLogin === 'github'}
							<span class="loading loading-spinner loading-md"></span>
						{/if}
						<Icon icon="mdi:github" />
						Sign in with GitHub</button
					>
				</div>
			{/if}

			{#if isOtpStep}
				<form class="mx-auto flex max-w-lg flex-col justify-center">
					<div class="flex justify-center space-x-2 p-4">
						{#each otp as value, index}
							<input
								inputmode="numeric"
								autofocus={index === 0}
								type="text"
								maxlength="1"
								pattern="\d*"
								class="bg-base-100 h-10 w-10 rounded-sm border text-center text-lg"
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
						disabled={isLoading || otp.some((v) => v === '')}
						class={`btn-primary btn mt-4 w-full rounded-md ${success ? 'bg-green-700' : ''}`}
						onclick={() => loginWithOtp()}
					>
						{#if isLoading}
							<span class="loading loading-spinner loading-md" />
						{:else}
							{success ? 'Logging in...' : 'Login'}
						{/if}
					</button>
					<div class="mt-4 text-red-500">{errorMessage}</div>
				</form>
			{/if}
		</div>
	</div>
</div>
