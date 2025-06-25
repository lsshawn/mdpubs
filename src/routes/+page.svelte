<script lang="ts">
	import { Twitter, Mail, MessageCircle, Calendar, Zap, Shield } from 'lucide-svelte';

	let deliveryMethod = $state('email');
	let twitterInput = $state('');
	let email = $state('');
	let telegram = $state('');

	function handleSubmit() {
		// Handle form submission and redirect to Stripe
		console.log({
			twitterInput,
			deliveryMethod,
			email: deliveryMethod === 'email' ? email : '',
			telegram: deliveryMethod === 'telegram' ? telegram : ''
		});
		// On success, you can programmatically close the modal like this:
		// (document.getElementById('subscribe_modal') as HTMLDialogElement).close();
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
	<!-- Header -->
	<header class="container mx-auto px-4 py-6">
		<div class="flex items-center justify-between">
			<div class="flex items-center space-x-2">
				<Twitter class="h-8 w-8 text-blue-600" />
				<span class="text-2xl font-bold text-gray-900">TwitterDigest</span>
			</div>
			<button class="btn btn-outline bg-white text-gray-700"> Sign In </button>
		</div>
	</header>

	<!-- Hero Section -->
	<section class="container mx-auto px-4 py-16 text-center">
		<div class="badge mb-4 border-none bg-blue-100 p-3 text-blue-800 hover:bg-blue-100">
			🚀 Early Bird Special - Limited Time
		</div>
		<h1 class="mb-6 text-5xl leading-tight font-bold text-gray-900">
			Never Miss What Matters on <span class="text-blue-600">Twitter</span>
		</h1>
		<p class="mx-auto mb-8 max-w-3xl text-xl text-gray-600">
			Get a curated summary of your favorite Twitter accounts or lists delivered every Wednesday.
			Stay informed without the endless scrolling.
		</p>

		<!-- Simplified Main CTA -->
		<div class="mx-auto max-w-xl">
			<!-- Open the modal using ID.showModal() method -->
			<button
				class="btn btn-lg border-none bg-blue-600 px-12 py-6 text-xl text-white hover:bg-blue-700"
				onclick={() => subscribe_modal.showModal()}>Get Started - $10/month</button
			>
			<dialog id="subscribe_modal" class="modal">
				<div class="modal-box max-w-2xl">
					<form method="dialog">
						<button class="btn btn-circle btn-ghost btn-sm absolute top-2 right-2">✕</button>
					</form>
					<h3 class="text-2xl font-bold">Start Your Weekly Digest</h3>
					<p class="py-4">
						Enter your Twitter source and choose how you'd like to receive your summaries
					</p>

					<form onsubmit={handleSubmit} class="mt-4 space-y-6">
						<!-- Twitter Input -->
						<div class="form-control w-full">
							<label for="twitter-input" class="label">
								<span class="label-text">Twitter Handle or List URL</span>
							</label>
							<input
								type="text"
								id="twitter-input"
								placeholder="@username or https://twitter.com/i/lists/123456789"
								bind:value={twitterInput}
								class="input input-bordered w-full text-lg"
								required
							/>
							<label class="label">
								<span class="label-text-alt"
									>Enter a Twitter username (e.g., @elonmusk) or a Twitter list URL</span
								>
							</label>
						</div>

						<!-- Delivery Method -->
						<div class="space-y-4">
							<label class="label">
								<span class="label-text">How would you like to receive summaries?</span>
							</label>
							<div class="space-y-2">
								<label
									class="flex cursor-pointer items-center space-x-2 rounded-lg border p-3 hover:bg-gray-50"
								>
									<input
										type="radio"
										name="deliveryMethod"
										class="radio"
										value="email"
										bind:group={deliveryMethod}
									/>
									<Mail class="h-5 w-5 text-gray-600" />
									<span class="flex-1"> Email Delivery </span>
								</label>
								<label
									class="flex cursor-pointer items-center space-x-2 rounded-lg border p-3 hover:bg-gray-50"
								>
									<input
										type="radio"
										name="deliveryMethod"
										class="radio"
										value="telegram"
										bind:group={deliveryMethod}
									/>
									<MessageCircle class="h-5 w-5 text-gray-600" />
									<span class="flex-1"> Telegram Bot </span>
								</label>
							</div>
						</div>

						<!-- Conditional Contact Input -->
						{#if deliveryMethod === 'email'}
							<div class="form-control w-full">
								<label for="email-input" class="label">
									<span class="label-text">Email Address</span>
								</label>
								<input
									id="email-input"
									type="email"
									placeholder="your@email.com"
									bind:value={email}
									class="input input-bordered w-full text-lg"
									required
								/>
							</div>
						{/if}

						{#if deliveryMethod === 'telegram'}
							<div class="form-control w-full">
								<label for="telegram-input" class="label">
									<span class="label-text">Telegram Username</span>
								</label>
								<input
									id="telegram-input"
									type="text"
									placeholder="@yourusername"
									bind:value={telegram}
									class="input input-bordered w-full text-lg"
									required
								/>
								<label class="label">
									<span class="label-text-alt"
										>Make sure to start a chat with our bot first: @TwitterDigestBot</span
									>
								</label>
							</div>
						{/if}

						<!-- Pricing and CTA -->
						<div class="rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 p-6">
							<div class="mb-4 text-center">
								<div class="mb-2 flex items-center justify-center space-x-2">
									<span class="text-3xl font-bold text-gray-900">$10</span>
									<span class="text-gray-600">/month</span>
									<div class="badge border-none bg-green-100 text-green-800">Early Bird</div>
								</div>
								<p class="text-sm text-gray-600">Regular price $19/month • Cancel anytime</p>
							</div>

							<button
								type="submit"
								class="btn btn-lg w-full border-none bg-blue-600 py-3 text-lg text-white hover:bg-blue-700"
							>
								Subscribe Now - $10/month
							</button>
						</div>
					</form>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button>close</button>
				</form>
			</dialog>

			<p class="mt-4 text-gray-600">Weekly Twitter summaries delivered every Wednesday</p>
		</div>
	</section>

	<!-- Features Section -->
	<section class="container mx-auto px-4 py-16">
		<h2 class="mb-12 text-center text-3xl font-bold text-gray-900">Why Choose TwitterDigest?</h2>
		<div class="grid gap-8 md:grid-cols-3">
			<div class="card border bg-white text-center shadow-sm">
				<div class="card-body items-center">
					<Calendar class="mx-auto mb-4 h-12 w-12 text-blue-600" />
					<h2 class="card-title justify-center">Weekly Summaries</h2>
					<p class="text-gray-600">
						Get perfectly timed summaries every Wednesday. Never miss important updates from your
						favorite accounts.
					</p>
				</div>
			</div>

			<div class="card border bg-white text-center shadow-sm">
				<div class="card-body items-center">
					<Zap class="mx-auto mb-4 h-12 w-12 text-blue-600" />
					<h2 class="card-title justify-center">AI-Powered Curation</h2>
					<p class="text-gray-600">
						Our AI identifies the most important and engaging tweets, filtering out noise and
						focusing on what matters.
					</p>
				</div>
			</div>

			<div class="card border bg-white text-center shadow-sm">
				<div class="card-body items-center">
					<Shield class="mx-auto mb-4 h-12 w-12 text-blue-600" />
					<h2 class="card-title justify-center">Privacy First</h2>
					<p class="text-gray-600">
						We only access public tweets and never store your personal data. Your privacy is our
						priority.
					</p>
				</div>
			</div>
		</div>
	</section>

	<!-- Honest Early Stage Section -->
	<section class="container mx-auto px-4 py-16 text-center">
		<div class="mx-auto max-w-2xl">
			<h2 class="mb-6 text-2xl font-bold text-gray-900">We're Just Getting Started</h2>
			<p class="mb-8 text-lg text-gray-600">
				TwitterDigest is a new service with our first 2 users already loving their weekly summaries.
				Join us early and help shape the future of Twitter content curation.
			</p>
			<div class="rounded-lg bg-blue-50 p-6">
				<p class="font-medium text-blue-800">
					🚀 Early Bird Benefits: Lock in $10/month pricing forever + Direct feedback line to
					improve the service
				</p>
			</div>
		</div>
	</section>

	<!-- FAQ -->
	<section class="container mx-auto px-4 py-16">
		<h2 class="mb-12 text-center text-3xl font-bold text-gray-900">Frequently Asked Questions</h2>
		<div class="mx-auto max-w-3xl space-y-6">
			<div class="card collapse-arrow border bg-white">
				<input type="checkbox" />
				<div class="collapse-title text-xl font-medium">How does the summary work?</div>
				<div class="collapse-content">
					<p class="text-gray-600">
						Our AI analyzes all tweets from your chosen accounts or lists from the past week,
						identifies the most important and engaging content, and creates a concise summary
						delivered every Wednesday.
					</p>
				</div>
			</div>

			<div class="card collapse-arrow border bg-white">
				<input type="checkbox" />
				<div class="collapse-title text-xl font-medium">Can I change my delivery method later?</div>
				<div class="collapse-content">
					<p class="text-gray-600">
						Yes! You can switch between email and Telegram delivery at any time through your account
						settings.
					</p>
				</div>
			</div>

			<div class="card collapse-arrow border bg-white">
				<input type="checkbox" />
				<div class="collapse-title text-xl font-medium">What if I want to cancel?</div>
				<div class="collapse-content">
					<p class="text-gray-600">
						You can cancel your subscription at any time. No long-term commitments or cancellation
						fees.
					</p>
				</div>
			</div>
		</div>
	</section>

	<!-- Footer -->
	<footer class="bg-gray-900 py-12 text-white">
		<div class="container mx-auto px-4">
			<div class="flex flex-col items-center justify-between md:flex-row">
				<div class="mb-4 flex items-center space-x-2 md:mb-0">
					<Twitter class="h-6 w-6" />
					<span class="text-xl font-bold">TwitterDigest</span>
				</div>
				<div class="flex space-x-6 text-sm">
					<a href="#" class="hover:text-blue-400"> Privacy Policy </a>
					<a href="#" class="hover:text-blue-400"> Terms of Service </a>
					<a href="#" class="hover:text-blue-400"> Contact </a>
				</div>
			</div>
			<div class="mt-8 border-t border-gray-800 pt-8 text-center text-sm text-gray-400">
				<p>&copy; 2024 TwitterDigest. All rights reserved.</p>
			</div>
		</div>
	</footer>
</div>
