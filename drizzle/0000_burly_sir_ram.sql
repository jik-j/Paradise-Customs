CREATE TABLE `workshop_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`entity_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`employee_id` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workshop_event_entity` ON `workshop_events` (`type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `workshop_event_time` ON `workshop_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `workshop_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
