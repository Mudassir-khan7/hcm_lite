import test from "node:test";
import assert from "node:assert/strict";
import { calculateAnnualTax, calculatePayrollEntry, scheduledWorkDates } from "../src/payroll.js";

const taxSlabs = [
  { upperLimit: 25000, ratePercent: 0, baseTax: 0 },
  { upperLimit: 75000, ratePercent: 10, baseTax: 0 },
  { upperLimit: null, ratePercent: 20, baseTax: 5000 }
];

test("calculates annual progressive tax from the configured base and marginal rates", () => {
  assert.equal(calculateAnnualTax(25000, taxSlabs), 0);
  assert.equal(calculateAnnualTax(50000, taxSlabs), 2500);
  assert.equal(calculateAnnualTax(100000, taxSlabs), 10000);
});

test("prorates monthly salary for a joiner and applies absent workday deductions", () => {
  const entry = calculatePayrollEntry({
    employee: {
      _id: "e-1",
      employeeCode: "E-1",
      firstName: "Taylor",
      lastName: "Morgan",
      monthlySalary: 3100,
      hireDate: new Date("2026-01-16")
    },
    monthStart: new Date("2026-01-01T00:00:00.000Z"),
    monthEnd: new Date("2026-01-31T00:00:00.000Z"),
    workDays: [1, 2, 3, 4, 5],
    attendance: [{ date: new Date("2026-01-19T00:00:00.000Z"), status: "absent" }],
    taxSlabs: [{ upperLimit: null, ratePercent: 0, baseTax: 0 }]
  });
  assert.equal(entry.proratedDays, 16);
  assert.equal(entry.grossPay, 1600);
  assert.equal(entry.deductedWorkdays, 1);
  assert.equal(entry.attendanceDeduction, 100);
  assert.equal(entry.netPay, 1500);
});

test("does not deduct approved paid leave and counts approved unpaid leave once", () => {
  const employee = {
    _id: "e-2",
    employeeCode: "E-2",
    firstName: "Casey",
    lastName: "Kim",
    monthlySalary: 3100,
    hireDate: new Date("2026-01-01")
  };
  const common = {
    employee,
    monthStart: new Date("2026-01-01T00:00:00.000Z"),
    monthEnd: new Date("2026-01-31T00:00:00.000Z"),
    workDays: [1, 2, 3, 4, 5],
    taxSlabs: [{ upperLimit: null, ratePercent: 0, baseTax: 0 }]
  };
  const paidLeave = calculatePayrollEntry({
    ...common,
    attendance: [{ date: new Date("2026-01-05T00:00:00.000Z"), status: "absent" }],
    leaveRequests: [{
      status: "approved",
      type: "annual",
      startDate: new Date("2026-01-05T00:00:00.000Z"),
      endDate: new Date("2026-01-05T00:00:00.000Z")
    }]
  });
  assert.equal(paidLeave.deductedWorkdays, 0);
  const unpaidLeave = calculatePayrollEntry({
    ...common,
    leaveRequests: [{
      status: "approved",
      type: "unpaid",
      startDate: new Date("2026-01-05T00:00:00.000Z"),
      endDate: new Date("2026-01-05T00:00:00.000Z")
    }]
  });
  assert.equal(unpaidLeave.deductedWorkdays, 1);
});

test("prorates a leaver through their termination date and excludes holidays from attendance workdays", () => {
  const workDates = scheduledWorkDates(
    "2026-01-01",
    "2026-01-05",
    [1, 2, 3, 4, 5],
    [{ date: "2026-01-01", name: "Holiday" }]
  );
  assert.deepEqual(workDates, ["2026-01-02", "2026-01-05"]);
  const entry = calculatePayrollEntry({
    employee: {
      _id: "e-3",
      employeeCode: "E-3",
      firstName: "Robin",
      lastName: "Lee",
      monthlySalary: 3100,
      hireDate: new Date("2026-01-01"),
      terminationDate: new Date("2026-01-10")
    },
    monthStart: new Date("2026-01-01T00:00:00.000Z"),
    monthEnd: new Date("2026-01-31T00:00:00.000Z"),
    workDays: [1, 2, 3, 4, 5],
    taxSlabs: [{ upperLimit: null, ratePercent: 0, baseTax: 0 }]
  });
  assert.equal(entry.proratedDays, 10);
  assert.equal(entry.grossPay, 1000);
});
