import { contextHostRoot } from "../paths.js";
import { localTimeZone } from "./date.js";
import { serviceCredential } from "@linger/service-kit/node";

export interface MemoryScheduleConfig {
  readonly concurrency: number;
  /** The process time zone; days and the hourly calendar turn over in it. */
  readonly timeZone: string;
  readonly weeklyDay: number;
  /** The local hour the Daily consolidation closes the previous day, 0-23;
   * midnight when unset. A machine asleep at midnight consolidates at the
   * first tick after this hour instead, through the calendar replay. */
  readonly dailyHour?: number;
}

export interface MemoryConfig {
  readonly dataRoot: string;
  readonly schedule: MemoryScheduleConfig;
  readonly serviceToken: string;
}

export function readMemoryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MemoryConfig {
  return Object.freeze({
    dataRoot: contextHostRoot(environment),
    schedule: Object.freeze({
      concurrency: 4,
      timeZone: localTimeZone(),
      weeklyDay: 1,
      dailyHour: memoryDailyHour(environment),
    }),
    serviceToken: requiredServiceCredential(environment),
  });
}

/** The configured consolidation hour, midnight when the variable is unset. */
function memoryDailyHour(environment: NodeJS.ProcessEnv): number {
  const raw = environment.MEMORY_DAILY_HOUR?.trim();
  if (!raw) return 0;
  if (!/^\d{1,2}$/u.test(raw) || Number(raw) > 23)
    throw new TypeError("MEMORY_DAILY_HOUR must be an hour from 0 to 23");
  return Number(raw);
}

function requiredServiceCredential(environment: NodeJS.ProcessEnv): string {
  const credential = serviceCredential("node-services-internal", environment);
  if (!credential) throw new TypeError("LINGER_SECRET_SEED is required");
  return credential;
}
