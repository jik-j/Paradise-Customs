CREATE TABLE `employee_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`action` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `employee_accounts` ADD `active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_accounts` ADD `permissions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_accounts` ADD `roster_revision` integer DEFAULT 0 NOT NULL;