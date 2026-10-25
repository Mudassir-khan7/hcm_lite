const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value) {
  if (typeof value !== "string" || !dateKeyPattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dateKeyInTimezone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function countLeaveDays(startDate, endDate, workDays, holidays = []) {
  if (!isDateKey(startDate) || !isDateKey(endDate) || endDate < startDate) {
    throw new RangeError("Leave dates must be valid and end on or after the start date.");
  }

  const workingDays = new Set(workDays);
  const holidayMap = new Map(holidays.map(({ date, name }) => [date, name]));
  const excludedDates = [];
  const yearlyAllocations = new Map();
  let requestedDays = 0;

  for (
    let current = new Date(`${startDate}T00:00:00.000Z`);
    current.toISOString().slice(0, 10) <= endDate;
    current.setUTCDate(current.getUTCDate() + 1)
  ) {
    const date = current.toISOString().slice(0, 10);
    const weekday = current.getUTCDay();
    if (!workingDays.has(weekday)) {
      excludedDates.push({ date, reason: "weekend", name: "" });
      continue;
    }
    if (holidayMap.has(date)) {
      excludedDates.push({ date, reason: "holiday", name: holidayMap.get(date) });
      continue;
    }
    requestedDays += 1;
    const year = current.getUTCFullYear();
    yearlyAllocations.set(year, (yearlyAllocations.get(year) || 0) + 1);
  }

  return {
    requestedDays,
    excludedDates,
    yearlyAllocations: [...yearlyAllocations].map(([year, days]) => ({ year, days }))
  };
}

export function localClockSeconds(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return values.hour * 3600 + values.minute * 60 + values.second;
}

export function assignAttendanceStatus(date, timeZone, officeRules, workLocation = "office") {
  if (officeRules.attendanceMode === "remote") return "remote";
  if (officeRules.attendanceMode === "hybrid" && workLocation === "remote") return "remote";

  const [startHour, startMinute] = officeRules.workStart.split(":").map(Number);
  const graceEnd = (startHour * 60 + startMinute + officeRules.graceMinutes) * 60;
  return localClockSeconds(date, timeZone) > graceEnd ? "late" : "present";
}
