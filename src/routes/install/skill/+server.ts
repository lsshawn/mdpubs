// GET /install/skill — the SKILL.md the installer drops into Claude Code and Codex.
import skill from '#lib/install/SKILL.md?raw';
import { serveInstallFile } from '../serve';
import type { RequestEvent } from './$types';

export const GET = ({ url }: RequestEvent) => serveInstallFile(skill, url.origin, 'text/markdown');
