import { json, type RequestEvent } from '@sveltejs/kit';
import { validateOtp } from '$lib/server/otp';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { createSession, setSessionTokenCookie } from '$lib/server/auth';

export async function POST(event: RequestEvent) {
	const { email, otp } = await event.request.json();

	try {
		const user = await validateOtp(otp, email);
		if (!user) {
			return json({ success: false, errorMessage: 'Invalid OTP' });
		}

		// reset all otp
		await db
			.update(table.user)
			.set({ otp: null, otpExpiry: null, otpAttempts: 0 })
			.where(eq(table.user.id, user.id));

		// TODO: if is a new month for tier user, reset AI chat credit

		const session = await createSession(user.id);
		setSessionTokenCookie(event, session.id, session.expiresAt);

		return json({ success: true });
	} catch (error) {
		console.log('LS -> src/routes/api/auth/login-with-otp/+server.ts:29 -> error: ', error);
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return json({ success: false, errorMessage });
	}
}
