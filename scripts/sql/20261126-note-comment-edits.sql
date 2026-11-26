-- Audit trail for edited margin comments: the wording before and after each edit.
-- One new table; nothing existing changes. Run once against the main DB.

CREATE TABLE `note_comment_edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comment_id` text NOT NULL,
	`note_id` integer NOT NULL,
	`body_before` text NOT NULL,
	`body_after` text NOT NULL,
	`edited_by_user_id` text,
	`ip_address` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_note_comment_edits_comment_id` ON `note_comment_edits` (`comment_id`);
CREATE INDEX `idx_note_comment_edits_note_id` ON `note_comment_edits` (`note_id`);
