import mongoose from "mongoose";

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, trim: true, default: "" },
    lastName: { type: String, trim: true, default: "" },
    role: { type: String, enum: ["admin", "hr", "manager", "employee"], required: true },
    employee: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
      required() {
        return this.role === "manager" || this.role === "employee";
      }
    },
    active: { type: Boolean, default: true },
    forcePasswordChange: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const employeeSchema = new Schema(
  {
    employeeCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    department: { type: String, trim: true, default: "" },
    position: { type: String, trim: true, default: "" },
    monthlySalary: { type: Number, min: 0, required: true, default: 0 },
    manager: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    hireDate: { type: Date, default: null },
    terminationDate: {
      type: Date,
      default: null,
      validate: {
        validator(value) {
          return !value || !this.hireDate || value >= this.hireDate;
        },
        message: "Termination date must be on or after hire date."
      }
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" }
  },
  { timestamps: true }
);

const attendanceSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    date: { type: Date, required: true },
    checkIn: { type: Date, default: null },
    checkOut: { type: Date, default: null },
    status: { type: String, enum: ["present", "absent", "late", "remote"], default: "present" },
    workLocation: { type: String, enum: ["office", "remote"], default: "office" },
    note: { type: String, trim: true, maxlength: 500, default: "" }
  },
  { timestamps: true }
);
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

const leaveRequestSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    type: { type: String, enum: ["annual", "sick", "personal", "unpaid", "other"], required: true },
    startDate: { type: Date, required: true },
    endDate: {
      type: Date,
      required: true,
      validate: {
        validator(value) {
          return !this.startDate || value >= this.startDate;
        },
        message: "Leave end date must be on or after its start date."
      }
    },
    requestedDays: { type: Number, min: 0, required: true, default: 0 },
    yearlyAllocations: {
      type: [{
        year: { type: Number, required: true },
        days: { type: Number, required: true, min: 0 }
      }],
      default: []
    },
    excludedDates: {
      type: [{
        date: { type: String, required: true },
        reason: { type: String, enum: ["weekend", "holiday"], required: true },
        name: { type: String, default: "" }
      }],
      default: []
    },
    reason: { type: String, trim: true, maxlength: 2000, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewNote: { type: String, trim: true, maxlength: 1000, default: "" },
    reviewedAt: { type: Date, default: null }
  },
  { timestamps: true }
);
leaveRequestSchema.index({ employee: 1, status: 1, startDate: 1, endDate: 1 });
leaveRequestSchema.index({ status: 1, createdAt: 1 });

const payrollRunSchema = new Schema(
  {
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { type: String, enum: ["draft", "processing", "paid", "finalized", "cancelled"], default: "draft" },
    entries: [
      {
        employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
        employeeCode: { type: String, required: true },
        employeeName: { type: String, required: true },
        grossPay: { type: Number, required: true, min: 0 },
        proratedDays: { type: Number, required: true, min: 0 },
        attendanceDeduction: { type: Number, required: true, min: 0 },
        taxablePay: { type: Number, required: true, min: 0 },
        annualizedTaxableIncome: { type: Number, required: true, min: 0 },
        annualTax: { type: Number, required: true, min: 0 },
        taxWithheld: { type: Number, required: true, min: 0 },
        deductedWorkdays: { type: Number, required: true, min: 0 },
        deductions: { type: Number, required: true, min: 0 },
        netPay: { type: Number, required: true, min: 0 }
      }
    ],
    monthKey: { type: String, required: true },
    taxSlabs: {
      type: [{
        upperLimit: { type: Number, default: null },
        ratePercent: { type: Number, required: true },
        baseTax: { type: Number, required: true }
      }],
      default: []
    },
    currency: { type: String, required: true, uppercase: true, default: "USD" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lockedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    lockedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null }
  },
  { timestamps: true }
);
payrollRunSchema.index({ monthKey: 1 }, { unique: true });

const settingsSchema = new Schema(
  {
    key: { type: String, unique: true, default: "app" },
    organizationName: { type: String, trim: true, default: "" },
    timezone: { type: String, default: "UTC" },
    currency: { type: String, uppercase: true, default: "USD" },
    departments: { type: [String], default: [] },
    designations: { type: [String], default: [] },
    officeRules: {
      workDays: { type: [Number], default: [1, 2, 3, 4, 5] },
      workStart: { type: String, default: "09:00" },
      workEnd: { type: String, default: "17:00" },
      graceMinutes: { type: Number, min: 0, max: 240, default: 10 },
      attendanceMode: { type: String, enum: ["office", "hybrid", "remote"], default: "office" }
    },
    leaveQuotas: {
      annual: { type: Number, min: 0, max: 365, default: 20 },
      sick: { type: Number, min: 0, max: 365, default: 10 },
      personal: { type: Number, min: 0, max: 365, default: 3 },
      unpaid: { type: Number, min: 0, max: 365, default: 0 }
    },
    taxSlabs: {
      type: [{
        upperLimit: { type: Number, min: 0, default: null },
        ratePercent: { type: Number, min: 0, max: 100, required: true },
        baseTax: { type: Number, min: 0, required: true, default: 0 }
      }],
      default: [{ upperLimit: null, ratePercent: 0, baseTax: 0 }]
    },
    holidays: {
      type: [{
        date: { type: String, required: true },
        name: { type: String, trim: true, required: true, maxlength: 100 }
      }],
      default: []
    },
    setupComplete: { type: Boolean, default: false },
    setupClaimId: { type: String, default: null },
    setupClaimedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true, trim: true },
    entityType: { type: String, required: true, trim: true },
    entityId: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: "" }
  },
  { timestamps: true }
);
auditLogSchema.index({ createdAt: -1 });

export const User = model("User", userSchema);
export const Employee = model("Employee", employeeSchema);
export const Attendance = model("Attendance", attendanceSchema);
export const LeaveRequest = model("LeaveRequest", leaveRequestSchema);
export const PayrollRun = model("PayrollRun", payrollRunSchema);
export const Settings = model("Settings", settingsSchema);
export const AuditLog = model("AuditLog", auditLogSchema);
