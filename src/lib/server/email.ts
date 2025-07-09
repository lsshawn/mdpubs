import Mailgun from 'mailgun.js';
import { MAILGUN_API_KEY, MAILGUN_DOMAIN } from '$env/static/private';
import { config } from '$lib/config';

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
	username: 'api',
	key: MAILGUN_API_KEY
});

export async function sendEmail(
	to: string,
	subject: string,
	text: string,
	isHtml = false,
	from = config.name
) {
	const data = {
		from: `${from}<do-not-reply@${MAILGUN_DOMAIN}>`,
		to,
		subject
	};
	if (isHtml) {
		data.html = text;
	} else {
		data.text = text;
	}

	return await mg.messages.create(MAILGUN_DOMAIN, data);
}
