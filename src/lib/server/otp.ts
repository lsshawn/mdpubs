import dayjs from 'dayjs';
import { db } from './db';
import * as table from './db/schema';
import { eq } from 'drizzle-orm';
import { dev } from '$app/environment';
import { serverConfig } from './config';

function generateRandomNumber(): string {
	return Math.floor(100000 + Math.random() * 900000).toString();
}

export const generateOTP = async (email: string) => {
	const updateObj = {
		otp: dev && email === 'l@sshawn.com' ? '888888' : generateRandomNumber(),
		otpExpiry: dayjs().add(serverConfig.otp.expirationMinutes, 'minute').toDate(),
		otpAttempts: 0
	};

	const existingUser = await db.select().from(table.user).where(eq(table.user.email, email));
	if (existingUser?.length) {
		await db.update(table.user).set(updateObj).where(eq(table.user.email, email));
	} else {
		await db.insert(table.user).values({ email, credits: 10, ...updateObj });
	}

	return updateObj;
};

export const validateOtp = async (otp: string, email: string): Promise<boolean | undefined> => {
	const user = (
		await db
			.select({
				id: table.user.id,
				otp: table.user.otp,
				otpExpiry: table.user.otpExpiry,
				email: table.user.email,
				otpAttempts: table.user.otpAttempts
			})
			.from(table.user)
			.where(eq(table.user.email, email))
	)[0];

	if (!user) throw new Error('User not found');

	if (!user.otp || user.otp !== otp) throw new Error('Invalid OTP');

	if (user?.otpExpiry < new Date().getTime()) throw new Error('OTP expired');

	if (user?.otpAttempts >= 6) throw new Error('Too many attempts');

	return user;
};
