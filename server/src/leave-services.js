import { LeaveRequest, Settings } from "./models.js";
import { countLeaveDays } from "./work-calendar.js";

export async function leaveEstimate(startDate, endDate) {
  const settings = await Settings.findOne({ key: "app" }).select("officeRules.workDays holidays").lean();
  return countLeaveDays(
    startDate,
    endDate,
    settings?.officeRules?.workDays || [1, 2, 3, 4, 5],
    settings?.holidays || []
  );
}

export async function getEmployeeLeavePolicy(employeeId, year) {
  const settings = await Settings.findOne({ key: "app" })
    .select("leaveQuotas officeRules.workDays holidays")
    .lean();
  const requests = await LeaveRequest.find({
    employee: employeeId,
    status: { $in: ["pending", "approved"] },
    "yearlyAllocations.year": year
  }).select("type yearlyAllocations").lean();
  const leaveTypes = ["annual", "sick", "personal", "unpaid"];
  const balances = Object.fromEntries(leaveTypes.map((type) => {
    const quota = settings?.leaveQuotas?.[type] ?? 0;
    const used = requests.reduce((total, request) => (
      request.type === type
        ? total + (request.yearlyAllocations.find((allocation) => allocation.year === year)?.days || 0)
        : total
    ), 0);
    return [type, { quota, used, remaining: Math.max(0, quota - used) }];
  }));
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const workDays = settings?.officeRules?.workDays || [1, 2, 3, 4, 5];
  return {
    year,
    balances,
    workDays: workDays.map((day) => weekdayNames[day]),
    holidays: (settings?.holidays || [])
      .filter(({ date }) => date.startsWith(String(year)))
      .map(({ date, name }) => ({ date, name }))
  };
}
