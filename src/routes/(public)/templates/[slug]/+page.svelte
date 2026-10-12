<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { config } from '#lib/config.js';
	import { checkoutHref } from '#lib/helpers/checkout.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(data.template);
	let heading = $derived(t.heading);
	let copied = $state(false);

	// JSON-LD is serialised here, not hand-written, so a quote in an FAQ answer
	// can't break the script block. `<` is escaped so the text can't close it.
	let jsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@graph': [
				{
					'@type': 'FAQPage',
					mainEntity: t.faqs.map((f) => ({
						'@type': 'Question',
						name: f.q,
						acceptedAnswer: { '@type': 'Answer', text: f.a }
					}))
				},
				{
					'@type': 'BreadcrumbList',
					itemListElement: [
						{
							'@type': 'ListItem',
							position: 1,
							name: 'Templates',
							item: data.canonical.replace(/\/[^/]+$/, '')
						},
						{ '@type': 'ListItem', position: 2, name: heading, item: data.canonical }
					]
				}
			]
		}).replace(/</g, '\\u003c')
	);

	// Built here because a literal script tag inside the markup ends the
	// component's own script block.
	let ldTag = $derived(`<script type="application/ld+json">${jsonLd}</` + `script>`);

	async function copy() {
		await navigator.clipboard.writeText(data.markdown);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function download() {
		const url = URL.createObjectURL(new Blob([data.markdown], { type: 'text/markdown' }));
		const a = Object.assign(document.createElement('a'), { href: url, download: `${t.slug}.md` });
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head>
	<title>{t.title}</title>
	<meta name="description" content={t.description} />
	<link rel="canonical" href={data.canonical} />
	<meta name="robots" content="index, follow" />
	<meta property="og:type" content="article" />
	<meta property="og:url" content={data.canonical} />
	<meta property="og:title" content={t.title} />
	<meta property="og:description" content={t.description} />
	<meta property="og:image" content="{page.url.origin}/og-default.png" />
	<meta name="twitter:card" content="summary_large_image" />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html ldTag}
</svelte:head>

<article class="mx-auto max-w-3xl px-4 py-10 md:py-14">
	<nav class="text-sm text-base-content/60">
		<a href={resolve('/(public)/templates')} class="link link-hover">Contract templates</a>
		<span class="mx-1">/</span>
		<span>{t.profession}</span>
	</nav>

	<h1 class="mt-3 text-3xl font-bold tracking-tight md:text-4xl">{heading}</h1>
	<p class="mt-2 text-sm text-base-content/60">Free to copy. Updated {t.updated}.</p>
	<p class="mt-5 text-lg leading-relaxed">{t.intro}</p>

	<div class="mt-6 flex flex-wrap gap-2">
		<button class="btn btn-neutral" onclick={copy}>{copied ? 'Copied' : 'Copy the contract'}</button
		>
		<button class="btn btn-ghost" onclick={download}>Download .md</button>
	</div>

	<section class="mt-10">
		<h2 class="text-xl font-semibold">What this {t.profession} contract covers</h2>
		<ul class="mt-3 list-disc space-y-2 pl-5">
			{#each t.covers as line (line)}
				<li>{line}</li>
			{/each}
		</ul>
	</section>

	<section class="mt-10 rounded-box border border-base-300 bg-base-100 p-5 md:p-8">
		<div class="prose max-w-none prose-headings:mt-6 prose-headings:mb-2">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html data.html}
		</div>
	</section>

	<section class="mt-10 rounded-box bg-base-200 p-5 md:p-6">
		<h2 class="text-xl font-semibold">Get it signed without printing it</h2>
		<p class="mt-2">
			MdPubs turns this contract into a link your client signs on their phone. Connect it to Claude,
			ChatGPT, Claude Code or Codex, then ask:
		</p>
		<blockquote class="mt-3 border-l-4 border-base-300 pl-4 italic">
			"Fill in the {t.profession} contract for [client], [fee], and send it to them to sign."
		</blockquote>
		<p class="mt-3 text-sm text-base-content/70">
			Your AI fills the placeholders and publishes it. You both sign, and you get the signed copy
			back. {page.data.pricing.monthly}/month, unlimited contracts.
		</p>
		<a
			href={checkoutHref(config.stripePaymentLinks.monthly.link)}
			class="btn btn-primary mt-4"
			data-umami-event="pseo-cta"
			data-umami-event-slug={t.slug}>Send it for signature</a
		>
	</section>

	<section class="mt-10">
		<h2 class="text-xl font-semibold">How to use this template</h2>
		<ol class="mt-3 list-decimal space-y-2 pl-5">
			<li>Copy the contract, or download the .md file.</li>
			<li>
				Replace every [bracketed] placeholder, and delete clauses that don't apply to the job.
			</li>
			<li>Agree the fee, deposit and dates with your client before sending.</li>
			<li>Send it for signature, and keep the signed copy with your project files.</li>
		</ol>
	</section>

	<section class="mt-10">
		<h2 class="text-xl font-semibold">Questions</h2>
		{#each t.faqs as f (f.q)}
			<h3 class="mt-5 font-semibold">{f.q}</h3>
			<p class="mt-1 leading-relaxed">{f.a}</p>
		{/each}
	</section>

	{#if data.related.length}
		<section class="mt-12 border-t border-base-300 pt-6">
			<h2 class="text-lg font-semibold">Related templates</h2>
			<ul class="mt-3 grid gap-2 sm:grid-cols-2">
				{#each data.related as r (r.slug)}
					<li>
						<a
							href={resolve('/(public)/templates/[slug]', { slug: r.slug })}
							class="link link-hover">{r.heading}</a
						>
					</li>
				{/each}
			</ul>
			<p class="mt-4">
				<a href={resolve('/(public)/templates')} class="link">All contract templates</a>
			</p>
		</section>
	{/if}

	<p class="mt-10 text-xs text-base-content/50">
		This template is a starting point, not legal advice. Have a lawyer check it against the law
		where you work.
	</p>
</article>
