<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const title = 'Free Contract Templates for Freelancers';
	const description =
		'Free contract templates for photographers, designers, consultants, DJs and more. Copy one, or send it to your client to sign online.';
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={data.canonical} />
	<meta name="robots" content="index, follow" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={data.canonical} />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10 md:py-14">
	<h1 class="text-3xl font-bold tracking-tight md:text-4xl">Contract templates for freelancers</h1>
	<p class="mt-4 text-lg leading-relaxed">
		Each template is a full contract written for one trade, with the clauses that trade argues about
		most: usage rights for photographers, overtime for DJs, whitelisting for UGC creators. Copy one,
		or have your AI fill it in and send it to your client to sign.
	</p>

	<ul class="mt-8 divide-y divide-base-300 border-y border-base-300">
		{#each data.templates as t (t.slug)}
			<li class="py-4">
				<a
					href={resolve('/(public)/templates/[slug]', { slug: t.slug })}
					class="link link-hover text-lg font-semibold">{t.heading}</a
				>
				<p class="mt-1 text-base-content/70">{t.description}</p>
			</li>
		{/each}
	</ul>
</div>
