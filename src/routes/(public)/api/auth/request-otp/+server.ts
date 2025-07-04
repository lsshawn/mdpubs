import { json, type RequestEvent } from '@sveltejs/kit';
import { generateOTP } from '$lib/server/otp';
import { sendEmail } from '$lib/server/email';
import { app } from '$lib/config';
import { dev } from '$app/environment';

import dayjs from 'dayjs';

const testEmails = ['l@sshawn.com'];

export async function POST({ locals, request }: RequestEvent) {
	const title = app.name;
	const { email } = await request.json();

	const otpObj = await generateOTP(email);
	// don't send email to test emails
	if (dev && testEmails.includes(email)) {
		return json({ success: true });
	}

	const otpExpiry = dayjs(otpObj.otpExpiry).format('DD MMM YY, HH:mm:ss [GMT]Z');
	const text = `<!DOCTYPE html>
	<html lang="en">
	<head>
	    <meta charset="UTF-8">
	    <meta name="viewport" content="width=device-width, initial-scale=1.0">
	    <title>${title} OTP to Login</title>
	</head>
	<body>
	<p>Hi! To continue logging in to ${title}, please enter your OTP: <strong>${otpObj.otp}</strong></p>
	<p><em>Expires at: ${otpExpiry}.</em></p>
	</body>
	</html>
	`;

	const res = await sendEmail(email, `OTP Login for ${title}`, text, true, title);
	if (res.status === 200) {
		return json({ success: true });
	} else {
		return json({ success: false });
	}
}
