import test from "node:test";
import assert from "node:assert/strict";
import {
  assignAttendanceStatus,
  countLeaveDays,
  dateKeyInTimezone,
  isDateKey
} from "../src/work-calendar.js";

test("counts only configured workdays and skips named holidays", () => {
  const result = countLeaveDays(
    "2026-10-23",
    "2026-10-28",
    [1, 2, 3, 4, 5],
    [{ date: "2026-10-26", name: "Founders Day" }]
  );
  assert.equal(result.requestedDays, 3);
  assert.deepEqual(result.excludedDates, [
    { date: "2026-10-24", reason: "weekend", name: "" },
    { date: "2026-10-25", reason: "weekend", name: "" },
    { date: "2026-10-26", reason: "holiday", name: "Founders Day" }
  ]);
});

test("allocates working days separately across calendar years", () => {
  const result = countLeaveDays("2026-12-31", "2027-01-04", [1, 2, 3, 4, 5]);
  assert.equal(result.requestedDays, 3);
  assert.deepEqual(result.yearlyAllocations, [
    { year: 2026, days: 1 },
    { year: 2027, days: 2 }
  ]);
});

test("validates date-only strings and calculates an organization's local date", () => {
  assert.equal(isDateKey("2026-02-28"), true);
  assert.equal(isDateKey("2026-02-30"), false);
  assert.equal(dateKeyInTimezone(new Date("2026-01-01T01:00:00.000Z"), "America/Los_Angeles"), "2025-12-31");
});

test("assigns attendance status using the configured timezone and grace period", () => {
  const rules = { attendanceMode: "office", workStart: "09:00", graceMinutes: 10 };
  assert.equal(assignAttendanceStatus(new Date("2026-06-01T09:10:00Z"), "UTC", rules), "present");
  assert.equal(assignAttendanceStatus(new Date("2026-06-01T09:10:01Z"), "UTC", rules), "late");
  assert.equal(
    assignAttendanceStatus(new Date("2026-06-01T10:00:00Z"), "UTC", { ...rules, attendanceMode: "hybrid" }, "remote"),
    "remote"
  );
  assert.equal(
    assignAttendanceStatus(new Date("2026-06-01T10:00:00Z"), "UTC", { ...rules, attendanceMode: "remote" }),
    "remote"
  );
});

test("requires leave ranges to be valid and ordered", () => {
  assert.throws(() => countLeaveDays("2026-10-30", "2026-10-29", [1, 2, 3, 4, 5]), RangeError);
});
