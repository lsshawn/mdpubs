/**
 * The installer files, with this site's origin filled in so a dev server or a
 * preview deploy installs a CLI that talks back to itself.
 */
export function serveInstallFile(source: string, origin: string, contentType: string): Response {
	return new Response(source.replaceAll('__ORIGIN__', origin), {
		headers: { 'content-type': `${contentType}; charset=utf-8`, 'cache-control': 'no-cache' }
	});
}
