-- AI tool access: CLI device login (/install) and MCP connectors (/mcp).
-- New tables only; nothing existing changes. Run once against the main DB.

CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`client_id` text,
	`created_at` integer DEFAULT (current_timestamp),
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `device_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code_hash` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (current_timestamp),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer DEFAULT (current_timestamp)
);
CREATE TABLE `oauth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `idx_api_tokens_token_hash` ON `api_tokens` (`token_hash`);
CREATE INDEX `idx_api_tokens_user` ON `api_tokens` (`user_id`);
CREATE UNIQUE INDEX `idx_device_codes_device_code_hash` ON `device_codes` (`device_code_hash`);
CREATE UNIQUE INDEX `idx_device_codes_user_code` ON `device_codes` (`user_code`);
CREATE UNIQUE INDEX `idx_oauth_codes_code_hash` ON `oauth_codes` (`code_hash`);
