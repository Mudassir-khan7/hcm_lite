import { Attendance, Employee, LeaveRequest, Settings } from "./models.js";

export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateAnnualTax(annualTaxableIncome, taxSlabs) {
  if (!Number.isFinite(annualTaxableIncome) || annualTaxableIncome < 0) {
    throw new RangeError("Annual taxable income must be a non-negative number.");
  }
  let lowerLimit = 0;
  for (const slab of taxSlabs) {
    if (slab.upperLimit === null || slab.upperLimit === undefined || annualTaxableIncome <= slab.upperLimit) {
      return roundMoney(slab.baseTax + Math.max(0, annualTaxableIncome - lowerLimit) * slab.ratePercent / 100);
    }
    lowerLimit = slab.upperLimit;
  }
  throw new RangeError("Tax slabs must include a final open-ended bracket.");
}

export function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function scheduledWorkDates(startDate, endDate, workDays, holidays = []) {
  const holidayDates = new Set(holidays.map((holiday) => holiday.date));
  const workingDays = new Set(workDays);
  const dates = [];
  for (
    let current = new Date(`${startDate}T00:00:00.000Z`);
    current.toISOString().slice(0, 10) <= endDate;
    current.setUTCDate(current.getUTCDate() + 1)
  ) {
    const date = current.toISOString().slice(0, 10);
    if (workingDays.has(current.getUTCDay()) && !holidayDates.has(date)) dates.push(date);
  }
  return dates;
}

export function calculatePayrollEntry({
  employee,
  monthStart,
  monthEnd,
  workDays,
  holidays = [],
  attendance = [],
  leaveRequests = [],
  taxSlabs
}) {
  const startKey = dateKey(monthStart);
  const endKey = dateKey(monthEnd);
  const hireKey = employee.hireDate ? dateKey(employee.hireDate) : startKey;
  const terminationKey = employee.terminationDate ? dateKey(employee.terminationDate) : endKey;
  const employedStart = hireKey > startKey ? hireKey : startKey;
  const employedEnd = terminationKey < endKey ? terminationKey : endKey;
  const daysInMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();

  if (employedStart > employedEnd) {
    throw new RangeError(`Employee ${employee.employeeCode} was not employed during the payroll month.`);
  }
  if (!Number.isFinite(employee.monthlySalary) || employee.monthlySalary <= 0) {
    throw new RangeError(`Monthly salary is missing for employee ${employee.employeeCode}.`);
  }

  const employedDays = Math.round(
    (Date.parse(`${employedEnd}T00:00:00.000Z`) - Date.parse(`${employedStart}T00:00:00.000Z`))
    / 86400000
  ) + 1;
  const proratedDays = roundMoney(employee.monthlySalary * employedDays / daysInMonth);
  const attendanceByDate = new Map(attendance.map((record) => [dateKey(record.date), record]));
  const approvedPaidLeaveDates = new Set();
  const approvedUnpaidLeaveDates = new Set();

  for (const request of leaveRequests) {
    if (request.status !== "approved") continue;
    const requestStart = dateKey(request.startDate) < employedStart ? employedStart : dateKey(request.startDate);
    const requestEnd = dateKey(request.endDate) > employedEnd ? employedEnd : dateKey(request.endDate);
    if (requestStart > requestEnd) continue;
    const dates = scheduledWorkDates(requestStart, requestEnd, workDays, holidays);
    const target = request.type === "unpaid" ? approvedUnpaidLeaveDates : approvedPaidLeaveDates;
    dates.forEach((date) => target.add(date));
  }

  const scheduledDates = scheduledWorkDates(employedStart, employedEnd, workDays, holidays);
  const deductions = new Set();
  for (const date of scheduledDates) {
    const record = attendanceByDate.get(date);
    if (approvedPaidLeaveDates.has(date)) continue;
    if (approvedUnpaidLeaveDates.has(date)) {
      if (!record || record.status === "absent") deductions.add(date);
      continue;
    }
    if (record?.status === "absent") deductions.add(date);
  }

  const dailySalary = employee.monthlySalary / daysInMonth;
  const attendanceDeduction = roundMoney(dailySalary * deductions.size);
  const grossPay = Math.max(0, proratedDays);
  const taxablePay = Math.max(0, roundMoney(grossPay - attendanceDeduction));
  const annualTaxableIncome = roundMoney(taxablePay * 12);
  const annualTax = calculateAnnualTax(annualTaxableIncome, taxSlabs);
  const taxWithheld = roundMoney(annualTax / 12);
  const totalDeductions = roundMoney(attendanceDeduction + taxWithheld);
  const netPay = Math.max(0, roundMoney(grossPay - totalDeductions));

  return {
    employee: employee._id,
    employeeCode: employee.employeeCode,
    employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
    monthlySalary: roundMoney(employee.monthlySalary),
    proratedDays: employedDays,
    grossPay,
    attendanceDeduction,
    deductedWorkdays: deductions.size,
    taxablePay,
    annualTaxableIncome,
    annualTax,
    taxWithheld,
    deductions: totalDeductions,
    netPay
  };
}

export async function calculateMonthlyPayroll(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const endExclusive = new Date(Date.UTC(year, month, 1));
  const settings = await Settings.findOne({ key: "app" })
    .select("currency officeRules.workDays holidays taxSlabs")
    .lean();
  const employees = await Employee.find({
    $or: [
      { status: "active" },
      { terminationDate: { $gte: monthStart } }
    ]
  }).lean();
  const eligibleEmployees = employees.filter((employee) =>
    employee.status === "active" || employee.terminationDate
  ).filter((employee) =>
    !employee.hireDate || new Date(employee.hireDate) <= monthEnd
  ).filter((employee) =>
    !employee.terminationDate || new Date(employee.terminationDate) >= monthStart
  );
  if (!eligibleEmployees.length) throw new RangeError("No employees are eligible for this payroll month.");

  const employeeIds = eligibleEmployees.map((employee) => employee._id);
  const [attendance, leaveRequests] = await Promise.all([
    Attendance.find({
      employee: { $in: employeeIds },
      date: { $gte: monthStart, $lt: endExclusive }
    }).select("employee date status").lean(),
    LeaveRequest.find({
      employee: { $in: employeeIds },
      status: "approved",
      startDate: { $lt: endExclusive },
      endDate: { $gte: monthStart }
    }).select("employee type startDate endDate status").lean()
  ]);
  const attendanceByEmployee = new Map();
  const leaveByEmployee = new Map();
  for (const record of attendance) {
    const id = String(record.employee);
    attendanceByEmployee.set(id, [...(attendanceByEmployee.get(id) || []), record]);
  }
  for (const request of leaveRequests) {
    const id = String(request.employee);
    leaveByEmployee.set(id, [...(leaveByEmployee.get(id) || []), request]);
  }

  const workDays = settings?.officeRules?.workDays || [1, 2, 3, 4, 5];
  const holidays = settings?.holidays || [];
  const taxSlabs = settings?.taxSlabs || [{ upperLimit: null, ratePercent: 0, baseTax: 0 }];
  const entries = eligibleEmployees.map((employee) => calculatePayrollEntry({
    employee,
    monthStart,
    monthEnd,
    workDays,
    holidays,
    attendance: attendanceByEmployee.get(String(employee._id)) || [],
    leaveRequests: leaveByEmployee.get(String(employee._id)) || [],
    taxSlabs
  }));

  return {
    periodStart: monthStart,
    periodEnd: monthEnd,
    monthKey,
    currency: settings?.currency || "USD",
    taxSlabs,
    entries
  };
}
