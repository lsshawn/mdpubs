import { createHash, randomBytes } from 'node:crypto';
import { database, InvalidAPIKeyError, NotFoundError } from '../db';
import type { User } from '$lib/server/db/schema';
import { addMinutes, isAfter } from 'date-fns';

export interface CreateUserRequest {
	email: string;
}

export interface ActivateUserRequest {
	email: string;
	otp: string;
}

export interface ResendOTPRequest {
	email: string;
}

export interface UpdateUserRequest {
	email?: string;
}

export class UserService {
	private db = database;

	// Generate API keys
	generateAPIKey(): string {
		return randomBytes(32).toString('hex');
	}

	generateReadOnlyAPIKey(): string {
		return 'ro_' + randomBytes(32).toString('hex');
	}

	// Hash API key for secure storage
	hashAPIKey(apiKey: string): string {
		return createHash('sha256').update(apiKey).digest('hex');
	}

	// Generate OTP
	generateOTP(): string {
		return Math.floor(100000 + Math.random() * 900000).toString();
	}

	// Get user by API key
	async getUserByAPIKey(apiKey: string): Promise<User> {
		const hashedKey = this.hashAPIKey(apiKey);

		const user = await this.db.getUserByApiKey(hashedKey);

		if (!user) {
			throw new InvalidAPIKeyError('Invalid API key');
		}

		return user;
	}

	// Get user by read-only API key
	async getUserByReadOnlyAPIKey(apiKey: string): Promise<User> {
		const hashedKey = this.hashAPIKey(apiKey);

		const user = await this.db.getUserByReadOnlyApiKey(hashedKey);

		if (!user) {
			throw new InvalidAPIKeyError('Invalid read-only API key');
		}

		return user;
	}

	// Get or create user
	async getOrCreateUser(email: string): Promise<{ user: User; isNew: boolean }> {
		// Try to find existing user
		const existingUser = await this.db.getUserByEmail(email);

		if (existingUser && !existingUser.deletedAt) {
			return {
				user: existingUser,
				isNew: false
			};
		}

		// Create new user
		const plainAPIKey = this.generateAPIKey();
		const plainReadOnlyAPIKey = this.generateReadOnlyAPIKey();
		const hashedAPIKey = this.hashAPIKey(plainAPIKey);
		const hashedReadOnlyAPIKey = this.hashAPIKey(plainReadOnlyAPIKey);

		const newUser = await this.db.createUser({
			email,
			apiKey: hashedAPIKey,
			readOnlyApiKey: hashedReadOnlyAPIKey,
			plan: 'free',
			isVerified: false,
			otpAttempts: 0
		});

		return {
			user: newUser,
			isNew: true
		};
	}

	// Create OTP for user
	async createUserOTP(userId: string): Promise<string> {
		const otp = this.generateOTP();
		const expiresAt = addMinutes(new Date(), 5);

		await this.db.updateUser(userId, {
			otp,
			// Destination schema names this column `otpExpiry` (API used `otpExpiresAt`).
			otpExpiry: expiresAt,
			otpAttempts: 0
		});

		return otp;
	}

	// Resend OTP
	async resendUserOTP(email: string): Promise<{ userId: string; otp: string }> {
		const user = await this.db.getUserByEmail(email);

		if (!user || user.deletedAt) {
			throw new NotFoundError('User not found');
		}

		if (user.isVerified) {
			throw new Error('User is already verified');
		}

		const otp = await this.createUserOTP(user.id);
		return { userId: user.id, otp };
	}

	// Validate OTP and activate user
	async validateUserOTP(
		email: string,
		otp: string
	): Promise<{ user: User; plainAPIKey: string; plainReadOnlyAPIKey: string }> {
		const user = await this.db.getUserByEmail(email);

		if (!user || user.deletedAt) {
			throw new NotFoundError('User not found');
		}

		if (user.isVerified) {
			throw new Error('User is already verified');
		}

		// Check if OTP has expired
		if (user.otpExpiry && isAfter(new Date(), user.otpExpiry)) {
			throw new Error('OTP has expired');
		}

		// Check attempt limit
		if ((user.otpAttempts || 0) >= 5) {
			throw new Error('Too many OTP attempts. Please request a new OTP.');
		}

		if (user.otp !== otp) {
			// Increment attempts
			await this.db.updateUser(user.id, {
				otpAttempts: (user.otpAttempts || 0) + 1
			});
			throw new Error('Invalid OTP');
		}

		// Generate new API keys for the activated user
		const plainAPIKey = this.generateAPIKey();
		const plainReadOnlyAPIKey = this.generateReadOnlyAPIKey();
		const hashedAPIKey = this.hashAPIKey(plainAPIKey);
		const hashedReadOnlyAPIKey = this.hashAPIKey(plainReadOnlyAPIKey);

		// Activate user and set new API keys
		const updatedUser = await this.db.updateUser(user.id, {
			isVerified: true,
			apiKey: hashedAPIKey,
			readOnlyApiKey: hashedReadOnlyAPIKey,
			otp: null,
			otpExpiry: null,
			otpAttempts: 0
		});

		return {
			user: updatedUser,
			plainAPIKey,
			plainReadOnlyAPIKey
		};
	}

	// Get all users (admin only)
	async getAllUsers(): Promise<User[]> {
		return await this.db.getAllUsers();
	}

	// Get user by ID
	async getUserById(userId: string): Promise<User> {
		const user = await this.db.getUserById(userId);

		if (!user) {
			throw new NotFoundError('User not found');
		}

		return user;
	}

	// Update user
	async updateUser(userId: string, email: string): Promise<User> {
		return await this.db.updateUser(userId, { email });
	}

	// Regenerate API key
	async regenerateAPIKey(userId: string): Promise<string> {
		const plainAPIKey = this.generateAPIKey();
		const hashedAPIKey = this.hashAPIKey(plainAPIKey);

		await this.db.updateUser(userId, { apiKey: hashedAPIKey });

		return plainAPIKey;
	}

	// Regenerate read-only API key
	async regenerateReadOnlyAPIKey(userId: string): Promise<string> {
		const plainReadOnlyAPIKey = this.generateReadOnlyAPIKey();
		const hashedReadOnlyAPIKey = this.hashAPIKey(plainReadOnlyAPIKey);

		await this.db.updateUser(userId, { readOnlyApiKey: hashedReadOnlyAPIKey });

		return plainReadOnlyAPIKey;
	}

	// Delete user (soft delete)
	async deleteUser(userId: string): Promise<void> {
		await this.db.updateUser(userId, { deletedAt: new Date() });
	}

	// Update user subscription
	async updateUserSubscription(
		userId: string,
		stripeCustomerId: string,
		subscriptionId: string,
		plan: string
	): Promise<void> {
		await this.db.updateUser(userId, {
			stripeCustomerId,
			subscriptionId,
			plan
		});
	}
}
