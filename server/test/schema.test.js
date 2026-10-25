import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Attendance, Employee, LeaveRequest, PayrollRun, Settings, User, AuditLog } from "../src/models.js";

test("registers every requested collection schema", () => {
  for (const model of [User, Employee, Attendance, LeaveRequest, PayrollRun, Settings, AuditLog]) {
    assert.ok(mongoose.models[model.modelName]);
  }
});

test("attendance enforces one record per employee per day", () => {
  const indexes = Attendance.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    keys.employee === 1 && keys.date === 1 && options.unique === true
  ));
});

test("user role and leave status are constrained enums", () => {
  assert.deepEqual(User.schema.path("role").enumValues, ["admin", "hr", "manager", "employee"]);
  assert.deepEqual(LeaveRequest.schema.path("status").enumValues, ["pending", "approved", "rejected"]);
});

test("employee and manager users require an employee record", () => {
  const user = new User({
    email: "person@example.com",
    passwordHash: "hash",
    role: "employee"
  });
  assert.ok(user.validateSync().errors.employee);
});

test("leave request dates cannot run backwards", () => {
  const request = new LeaveRequest({
    employee: new mongoose.Types.ObjectId(),
    type: "annual",
    startDate: new Date("2026-05-10"),
    endDate: new Date("2026-05-09"),
    reason: "Personal time"
  });
  assert.ok(request.validateSync().errors.endDate);
});

test("settings include office rules, teams, and leave quotas", () => {
  const settings = new Settings();
  assert.deepEqual(settings.officeRules.workDays, [1, 2, 3, 4, 5]);
  assert.equal(settings.officeRules.attendanceMode, "office");
  assert.equal(settings.leaveQuotas.annual, 20);
  assert.deepEqual(settings.departments, []);
  assert.deepEqual(settings.designations, []);
  assert.deepEqual(settings.holidays, []);
  assert.equal(settings.taxSlabs.length, 1);
  assert.equal(settings.taxSlabs[0].upperLimit, null);
  assert.equal(settings.taxSlabs[0].ratePercent, 0);
  assert.equal(settings.taxSlabs[0].baseTax, 0);
});

test("employees store monthly compensation and leaver dates", () => {
  const employee = new Employee({
    employeeCode: "E-2",
    firstName: "Jamie",
    lastName: "Fox",
    email: "jamie@example.com",
    monthlySalary: 4200,
    hireDate: new Date("2024-01-01"),
    terminationDate: new Date("2026-06-30")
  });
  assert.equal(employee.validateSync(), undefined);
  assert.equal(employee.monthlySalary, 4200);
  const invalidEmployee = new Employee({
    employeeCode: "E-3",
    firstName: "Jordan",
    lastName: "Parker",
    email: "jordan@example.com",
    hireDate: new Date("2026-06-02"),
    terminationDate: new Date("2026-06-01")
  });
  assert.ok(invalidEmployee.validateSync().errors.terminationDate);
});

test("payroll runs persist a lock state and unique month key", () => {
  const indexes = PayrollRun.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.monthKey === 1 && options.unique === true));
  assert.ok(PayrollRun.schema.path("status").enumValues.includes("finalized"));
});

test("payroll entries persist annualized taxable income for payslips", () => {
  const run = new PayrollRun({
    periodStart: new Date("2026-06-01"),
    periodEnd: new Date("2026-06-30"),
    monthKey: "2026-06",
    createdBy: new mongoose.Types.ObjectId(),
    entries: [{
      employee: new mongoose.Types.ObjectId(),
      employeeCode: "E-1",
      employeeName: "Alex Example",
      monthlySalary: 5000,
      proratedDays: 30,
      grossPay: 5000,
      attendanceDeduction: 0,
      taxablePay: 5000,
      annualizedTaxableIncome: 60000,
      annualTax: 5000,
      taxWithheld: 416.67,
      deductedWorkdays: 0,
      deductions: 416.67,
      netPay: 4583.33
    }]
  });
  assert.equal(run.validateSync(), undefined);
  assert.equal(run.entries[0].annualizedTaxableIncome, 60000);
});

test("leave requests retain calculated working-day and exclusion details", () => {
  const request = new LeaveRequest({
    employee: new mongoose.Types.ObjectId(),
    type: "annual",
    startDate: new Date("2026-05-01"),
    endDate: new Date("2026-05-04"),
    reason: "Personal time",
    requestedDays: 1,
    yearlyAllocations: [{ year: 2026, days: 1 }],
    excludedDates: [{ date: "2026-05-02", reason: "weekend" }]
  });
  assert.equal(request.validateSync(), undefined);
  assert.equal(request.requestedDays, 1);
});
