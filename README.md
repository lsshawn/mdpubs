# NeoNote Web

This is the web interface for **NeoNote**, a service that syncs your markdown notes from Neovim to the cloud so your thoughts are always safe, organized, and accessible.

This project is built with SvelteKit, Tailwind CSS, and daisyUI.

## Developing

Once you've cloned the project and installed dependencies with `pnpm install`, you can start a development server:

```bash
pnpm run dev

# or start the server and open the app in a new browser tab
pnpm run dev -- --open
```

## Building

To create a production version of your app:

```bash
pnpm run build
```

You can preview the production build with `pnpm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.
