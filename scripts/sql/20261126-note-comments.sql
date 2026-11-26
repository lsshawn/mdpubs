-- Margin comments on published notes (mdpubs-comments frontmatter).
-- One new table; nothing existing changes. Run once against the main DB.

CREATE TABLE `note_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` integer NOT NULL,
	`parent_id` text,
	`anchor` text,
	`body` text NOT NULL,
	`user_id` text,
	`author_name` text NOT NULL,
	`author_email` text,
	`author_key_hash` text,
	`ip_address` text,
	`resolved_at` integer,
	`resolved_by_user_id` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `idx_note_comments_note_id` ON `note_comments` (`note_id`);
CREATE INDEX `idx_note_comments_parent_id` ON `note_comments` (`parent_id`);
