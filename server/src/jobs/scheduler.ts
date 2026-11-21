import cron from "node-cron";
import { env } from "../config/env.js";
import { childLogger } from "../lib/logger.js";
import { runCheckInWatchdogJob } from "./checkInWatchdog.job.js";
import { runMedicationReminderJob } from "./medicationReminder.job.js";

const log = childLogger("scheduler");

/**
 * Prevent a slow run from overlapping with the next tick.
 *
 * `node-cron` would otherwise start a second instance of the job while the
 * first one is still working, which for the reminder job would produce
 * duplicate e-mails.
 */
const running = new Set<string>();

function guarded(name: string, task: () => Promise<void>): void {
  if (running.has(name)) {
    log.warn({ job: name }, "skipping job — previous run is still in progress");
    return;
  }

  running.add(name);
  void task()
    .catch((error) => log.error({ err: error, job: name }, "job failed"))
    .finally(() => running.delete(name));
}

/**
 * Start the background jobs.
 *
 * The schedules are expressed in UTC because every job derives the *local*
 * time of each elder from the database — the cron expression only decides
 * *when the platform looks*, not *when a reminder is due*.
 */
export function startJobs(): void {
  if (!env.JOBS_ENABLED) {
    log.info("background jobs are disabled (JOBS_ENABLED=false)");
    return;
  }

  cron.schedule(
    "* * * * *",
    () => guarded("medication-reminder", runMedicationReminderJob),
    { timezone: "UTC" },
  );

  cron.schedule(
    "*/15 * * * *",
    () => guarded("check-in-watchdog", runCheckInWatchdogJob),
    { timezone: "UTC" },
  );

  log.info("background jobs started");
}

export function stopJobs(): void {
  // node-cron keeps no global registry in v4; destroying the tasks is done by
  // the process exit path in src/index.ts.
}
