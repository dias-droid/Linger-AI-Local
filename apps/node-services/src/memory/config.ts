import { contextHostRoot } from "../paths.js";
import { localTimeZone } from "./date.js";
import { serviceCredential } from "@linger/service-kit/node";

export interface MemoryScheduleConfig {
  readonly concurrency: number;
  readonly dailyHour: number;
  /** The process time zone; days and the hourly calendar turn over in it. */
  readonly timeZone: string;
  readonly weeklyDay: number;
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
      dailyHour: readDailyHour(environment.MEMORY_DAILY_HOUR),
      timeZone: localTimeZone(),
      weeklyDay: 1,
    }),
    serviceToken: requiredServiceCredential(environment),
  });
}

function readDailyHour(raw: string | undefined): number {
  const value = raw?.trim() || "0";
  const hour = Number(value);
  if (!/^\d{1,2}$/u.test(value) || hour > 23)
    throw new TypeError("MEMORY_DAILY_HOUR must be an integer from 0 to 23");
  return hour;
}

function requiredServiceCredential(environment: NodeJS.ProcessEnv): string {
  const credential = serviceCredential("node-services-internal", environment);
  if (!credential) throw new TypeError("LINGER_SECRET_SEED is required");
  return credential;
}
