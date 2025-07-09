import Mailgun from 'mailgun.js';
import { MAILGUN_API_KEY } from '$env/static/private';
import { serverConfig } from '$lib/server/config';

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
	username: 'api',
	key: MAILGUN_API_KEY
});

export async function sendEmail(to: string, subject: string, text: string, isHtml = false) {
	const data = {
		from: serverConfig.email.from,
		to,
		subject,
		...(isHtml ? { html: text } : { text })
	};

	return await mg.messages.create(serverConfig.email.domain, data);
}
