// GET /install/cli — the `mdpubs` CLI the installer downloads.
import script from '#lib/install/mdpubs.sh?raw';
import { serveInstallFile } from '../serve';
import type { RequestEvent } from './$types';

export const GET = ({ url }: RequestEvent) =>
	serveInstallFile(script, url.origin, 'text/x-shellscript');
