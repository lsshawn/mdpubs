import { json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { feedbackDb } from '$lib/server/db';
import { feedback } from '$lib/server/db/feedback.schema';
import { app } from '$lib/config';
import { z } from 'zod';

const feedbackSchema = z.object({
	message: z.string().optional(),
	email: z.string().email(),
	page: z.string().optional(),
	metadata: z.record(z.any()).optional()
});

export async function POST(event: RequestEvent) {
	const body = await event.request.json();

	const validation = feedbackSchema.safeParse(body);
	if (!validation.success) {
		return json({ error: 'Invalid input', details: validation.error.flatten() }, { status: 400 });
	}

	const { message, email, page, metadata } = validation.data;
	console.log('[LS] -> src/routes/(public)/api/feedback/+server.ts:22 -> metadata: ', metadata);
	const origin = event.request.headers.get('origin');

	// Insert feedback
	await feedbackDb.insert(feedback).values({
		userId: event.locals.user?.id,
		projectId: app.feedbackProjectId,
		message,
		email,
		page,
		userAgent: event.request.headers.get('user-agent'),
		ipAddress: event.getClientAddress(),
		metadata
	});

	const headers: Record<string, string> = {};
	if (origin) {
		headers['Access-Control-Allow-Origin'] = origin;
	}

	return json(
		{ success: true },
		{
			headers
		}
	);
}

export async function OPTIONS() {
	return new Response(null, {
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type'
		}
	});
}
