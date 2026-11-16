CREATE TABLE `employee_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`grade` integer NOT NULL,
	`password_hash` text,
	`credential_version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employee_login_attempts` (
	`bucket` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `employee_attempt_expiry` ON `employee_login_attempts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `employee_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `employee_session_expiry` ON `employee_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `employee_password_requests` (
	`employee_id` text PRIMARY KEY NOT NULL,
	`proposed_hash` text,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`reviewed_by` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employee_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `employee_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
