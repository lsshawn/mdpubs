import { json, type RequestEvent } from '@sveltejs/kit';
import { generateOTP } from '$lib/server/otp';
import { sendEmail } from '$lib/server/email';
import { config } from '$lib/config';
import { serverConfig } from '$lib/server/config';
import { dev } from '$app/environment';

const testEmails = ['l@sshawn.com'];

export async function POST({ locals, request }: RequestEvent) {
	const title = config.name;
	const { email } = await request.json();
	const otpConfig = serverConfig.email.otp;

	const otpObj = await generateOTP(email);
	// don't send email to test emails
	if (dev && testEmails.includes(email)) {
		return json({ success: true });
	}

	const text = `<html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin-bottom: 10px;">${title}</h1>
            <p style="color: #666; margin: 0;">Login</p>
          </div>
          
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; text-align: center; margin-bottom: 30px;">
            <h2 style="color: #333; margin-bottom: 15px;">Your One-Time Password</h2>
            <div style="background-color: #007bff; color: white; font-size: 32px; font-weight: bold; padding: 20px; border-radius: 8px; letter-spacing: 4px; margin: 20px 0;">
              ${otpObj.otp}
            </div>
            <p style="color: #666; margin: 0;">Enter this code to log in to your ${title} account</p>
          </div>
          
          <div style="color: #666; font-size: 14px; line-height: 1.5;">
            <p><strong>Important:</strong></p>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>This code will expire in <strong>${otpConfig.expirationMinutes} minutes</strong></li>
              <li>Use this code only on the ${title} website</li>
              <li>If you didn't request this code, please ignore this email</li>
            </ul>
          </div>
          
          <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center; color: #999; font-size: 12px;">
            <p>This is an automated message from ${title}. Please do not reply to this email.</p>
          </div>
        </body>
      </html>`;

	const res = await sendEmail(email, otpConfig.subject, text, true);
	if (res.status === 200) {
		return json({ success: true });
	} else {
		return json({ success: false });
	}
}
