<script lang="ts">
	import { page } from '$app/stores';
	import { MetaTags } from 'svelte-meta-tags';

	const url = $page.url.origin;

	let { customMeta = {} } = $props();
	const meta = {
		title: 'NeoNote',
		desc: 'Fastest way to publish markdown Neovim',
		url: $page.url.href,
		image: url + '/logo.png',
		twitter: '',
		twitterImage: '',
		...customMeta
	};
</script>

<MetaTags
	title={meta.title}
	titleTemplate={`${meta.title}: ${meta.desc}`}
	description={meta.desc}
	canonical={meta.url}
	openGraph={{
		url: meta.url,
		title: meta.title,
		description: meta.desc,
		type: 'website',
		images: [
			{
				url: meta.image,
				width: 800,
				height: 600,
				alt: meta.title
			}
		]
	}}
	twitter={{
		handle: meta.twitter,
		site: meta.twitter,
		cardType: 'summary_large_image',
		title: meta.title,
		description: meta.desc,
		image: meta.twitterImage,
		imageAlt: meta.titleeovi
	}}
/>
