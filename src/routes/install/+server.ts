// GET /install — `curl -fsSL https://mdpubs.com/install | sh`
import script from '#lib/install/install.sh?raw';
import { serveInstallFile } from './serve';
import type { RequestEvent } from './$types';

export const GET = ({ url }: RequestEvent) =>
	serveInstallFile(script, url.origin, 'text/x-shellscript');
