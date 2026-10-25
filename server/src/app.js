import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { authenticate, employeeScope, requireRoles, scopedEmployeeIds } from "./auth.js";
import { employeeInputSchema, parseEmployeeCsv } from "./employeeCsv.js";
import {
  Attendance,
  AuditLog,
  Employee,
  LeaveRequest,
  PayrollRun,
  Settings,
  User
} from "./models.js";
import { assignAttendanceStatus, dateKeyInTimezone, isDateKey } from "./work-calendar.js";
import { calculateMonthlyPayroll } from "./payroll.js";
import { sendPayslipPdf } from "./payslip.js";
import { getEmployeeLeavePolicy, leaveEstimate } from "./leave-services.js";
import { generateLeaveAssistantReply } from "./gemini.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "20kb" }));
app.use("/api/employees/import", express.text({ type: "text/csv", limit: "1mb" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." }
});

const assistantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many assistant requests. Try again later." }
});

const taxSlabsSchema = z.array(z.object({
  upperLimit: z.number().positive().nullable(),
  ratePercent: z.number().min(0).max(100),
  baseTax: z.number().min(0)
})).min(1).max(20).refine((slabs) => (
  slabs[slabs.length - 1].upperLimit === null &&
  slabs.slice(0, -1).every((slab) => slab.upperLimit !== null)
), {
  message: "Tax slabs need exactly one open-ended final bracket."
}).refine((slabs) => {
  let previousLimit = 0;
  for (const slab of slabs) {
    if (slab.upperLimit !== null && slab.upperLimit <= previousLimit) return false;
    if (slab.upperLimit !== null) previousLimit = slab.upperLimit;
  }
  return true;
}, {
  message: "Tax slab income thresholds must increase."
});

const setupSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(1).max(64),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  taxSlabs: taxSlabsSchema
});

const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
});

const settingsSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(1).max(64),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  departments: z.array(z.string().trim().min(1).max(100)).max(100),
  designations: z.array(z.string().trim().min(1).max(100)).max(100),
  officeRules: z.object({
    workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    workStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    workEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    graceMinutes: z.number().int().min(0).max(240),
    attendanceMode: z.enum(["office", "hybrid", "remote"])
  }).refine((rules) => rules.workEnd > rules.workStart, {
    message: "Office end time must be after start time."
  }),
  leaveQuotas: z.object({
    annual: z.number().min(0).max(365),
    sick: z.number().min(0).max(365),
    personal: z.number().min(0).max(365),
    unpaid: z.number().min(0).max(365)
  }),
  holidays: z.array(z.object({
    date: z.string().refine(isDateKey, "Enter a valid holiday date."),
    name: z.string().trim().min(1).max(100)
  })).max(500),
  taxSlabs: taxSlabsSchema
}).refine(
  (settings) => new Set(settings.departments.map((name) => name.toLowerCase())).size === settings.departments.length,
  { message: "Department names must be unique." }
).refine(
  (settings) => new Set(settings.designations.map((name) => name.toLowerCase())).size === settings.designations.length,
  { message: "Designation names must be unique." }
).refine(
  (settings) => new Set(settings.officeRules.workDays).size === settings.officeRules.workDays.length,
  { message: "Select each work day only once." }
).refine(
  (settings) => new Set(settings.holidays.map(({ date }) => date)).size === settings.holidays.length,
  { message: "Holiday dates must be unique." }
);

function validationError(res, error) {
  return res.status(400).json({ error: error.issues[0]?.message || "Invalid request." });
}

async function logAction(req, action, entityType, entityId = null, details = {}) {
  await AuditLog.create({
    actor: req.user?._id || null,
    action,
    entityType,
    entityId: entityId ? String(entityId) : null,
    details,
    ipAddress: req.ip
  });
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/auth/setup-status", async (_req, res, next) => {
  try {
    const settings = await Settings.findOne({ key: "app" }).select("setupComplete");
    const hasAdmin = await User.exists({ role: "admin" });
    return res.json({ setupRequired: !settings?.setupComplete && !hasAdmin });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/setup", async (req, res, next) => {
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const claimId = crypto.randomUUID();
  const now = new Date();
  try {
    const settings = await Settings.findOneAndUpdate(
      {
        key: "app",
        setupComplete: { $ne: true },
        $or: [
          { setupClaimId: null },
          { setupClaimId: { $exists: false } },
          { setupClaimedAt: { $lt: new Date(now.getTime() - 5 * 60 * 1000) } }
        ]
      },
      { $set: { setupClaimId: claimId, setupClaimedAt: now } },
      { new: true }
    );
    if (!settings || await User.exists({ role: "admin" })) {
      return res.status(409).json({ error: "Initial setup has already been completed." });
    }

    try {
      const { organizationName, timezone, currency, firstName, lastName, email, password, taxSlabs } = parsed.data;
      const passwordHash = await bcrypt.hash(password, 12);
      const admin = await User.create({ email, passwordHash, firstName, lastName, role: "admin" });
      await Settings.updateOne(
        { key: "app", setupClaimId: claimId },
        {
          $set: { organizationName, timezone, currency, taxSlabs, setupComplete: true },
          $unset: { setupClaimId: 1, setupClaimedAt: 1 }
        }
      );
      await AuditLog.create({
        actor: admin._id,
        action: "initial_setup",
        entityType: "settings",
        details: { organizationName, adminEmail: email },
        ipAddress: req.ip
      });
      const token = jwt.sign({ sub: String(admin._id) }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "8h"
      });
      return res.status(201).json({
        token,
        user: {
          id: String(admin._id),
          email: admin.email,
          role: admin.role,
          firstName: admin.firstName,
          lastName: admin.lastName
        }
      });
    } catch (error) {
      await Settings.updateOne(
        { key: "app", setupClaimId: claimId, setupComplete: false },
        { $unset: { setupClaimId: 1, setupClaimedAt: 1 } }
      );
      if (error?.code === 11000) return res.status(409).json({ error: "That email is already registered." });
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  try {
    const user = await User.findOne({ email: parsed.data.email }).select("+passwordHash");
    if (!user?.active || !await bcrypt.compare(parsed.data.password, user.passwordHash)) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h"
    });
    return res.json({
      token,
      user: {
        id: String(user._id),
        email: user.email,
        role: user.role,
        employeeId: user.employee,
        firstName: user.firstName,
        lastName: user.lastName,
        forcePasswordChange: user.forcePasswordChange
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({
    user: {
      id: String(req.user._id),
      email: req.user.email,
      role: req.user.role,
      employeeId: req.user.employee,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      forcePasswordChange: req.user.forcePasswordChange
    }
  });
});

app.post("/api/auth/change-password", authenticate, async (req, res, next) => {
  const parsed = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128)
  }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  try {
    const user = await User.findById(req.user._id).select("+passwordHash");
    if (!user || !await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }
    user.passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    user.forcePasswordChange = false;
    await user.save();
    await logAction(req, "change_password", "user", user._id);
    return res.json({ message: "Password updated. Sign in again with your new password." });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/employees", authenticate, requireRoles("admin", "hr", "manager"), async (req, res, next) => {
  try {
    const scope = await employeeScope(req.user);
    const employees = await Employee.find(scope)
      .select("employeeCode firstName lastName email department position manager hireDate status")
      .sort({ lastName: 1, firstName: 1 })
      .lean();
    return res.json({ employees });
  } catch (error) {
    return next(error);
  }
});

async function employeeConflicts(rows) {
  const validRows = rows.filter((row) => row.data);
  const codes = [...new Set(validRows.map((row) => row.data.employeeCode))];
  const emails = [...new Set(validRows.map((row) => row.data.email))];
  const [employees, users] = await Promise.all([
    Employee.find({
      $or: [{ employeeCode: { $in: codes } }, { email: { $in: emails } }]
    }).select("employeeCode email").lean(),
    User.find({ email: { $in: emails } }).select("email").lean()
  ]);
  const existingCodes = new Set(employees.map((employee) => employee.employeeCode.toUpperCase()));
  const existingEmails = new Set([
    ...employees.map((employee) => employee.email.toLowerCase()),
    ...users.map((user) => user.email.toLowerCase())
  ]);
  for (const row of validRows) {
    if (existingCodes.has(row.data.employeeCode)) row.errors.push("employeeCode: already exists.");
    if (existingEmails.has(row.data.email)) row.errors.push("email: already has a user account.");
  }
}

async function createEmployeeAccount(data) {
  const tempPassword = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const employee = await Employee.create({
    employeeCode: data.employeeCode,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    department: data.department,
    position: data.position,
    monthlySalary: data.monthlySalary,
    hireDate: data.hireDate || null,
    terminationDate: data.terminationDate || null,
    status: data.terminationDate && dateKeyInTimezone(data.terminationDate, "UTC") < dateKeyInTimezone(new Date(), "UTC")
      ? "inactive"
      : "active"
  });
  try {
    const user = await User.create({
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      role: "employee",
      employee: employee._id,
      active: employee.status === "active",
      forcePasswordChange: true
    });
    return { employee, user, tempPassword };
  } catch (error) {
    await Employee.deleteOne({ _id: employee._id });
    throw error;
  }
}

app.post("/api/employees", authenticate, requireRoles("admin", "hr"), async (req, res, next) => {
  const parsed = employeeInputSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  try {
    const candidate = { data: parsed.data, errors: [] };
    await employeeConflicts([candidate]);
    if (candidate.errors.length) {
      return res.status(409).json({ error: candidate.errors[0].split(": ")[1] });
    }
    const { employee, user, tempPassword } = await createEmployeeAccount(parsed.data);
    await logAction(req, "create", "employee", employee._id, { userId: String(user._id) });
    return res.status(201).json({
      employee,
      account: { email: user.email, tempPassword, mustChangePassword: true }
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: "Employee code or email is already registered." });
    return next(error);
  }
});

async function validateCsvRequest(csv) {
  const result = parseEmployeeCsv(csv);
  if (!result.errors.length) await employeeConflicts(result.rows);
  return result;
}

app.post(
  "/api/employees/import/validate",
  authenticate,
  requireRoles("admin", "hr"),
  async (req, res, next) => {
    try {
      const csv = typeof req.body === "string" ? req.body : req.body?.csv;
      const result = await validateCsvRequest(csv);
      return res.status(result.errors.length ? 400 : 200).json({
        errors: result.errors,
        rows: result.rows.map(({ row, errors }) => ({ row, valid: errors.length === 0, errors })),
        validCount: result.rows.filter((row) => row.errors.length === 0).length,
        invalidCount: result.rows.filter((row) => row.errors.length > 0).length
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.post(
  "/api/employees/import",
  authenticate,
  requireRoles("admin", "hr"),
  async (req, res, next) => {
    try {
      const csv = typeof req.body === "string" ? req.body : req.body?.csv;
      const result = await validateCsvRequest(csv);
      if (result.errors.length) return res.status(400).json({ errors: result.errors, rows: [] });
      if (result.rows.some((row) => row.errors.length)) {
        return res.status(400).json({
          error: "Fix all row errors before importing.",
          rows: result.rows.map(({ row, errors }) => ({ row, errors }))
        });
      }

      const created = [];
      const failures = [];
      for (const row of result.rows) {
        try {
          const { employee, user, tempPassword } = await createEmployeeAccount(row.data);
          created.push({
            row: row.row,
            employeeId: String(employee._id),
            employeeCode: employee.employeeCode,
            email: user.email,
            tempPassword
          });
        } catch (error) {
          if (error?.code === 11000) {
            failures.push({ row: row.row, error: "Employee code or email was registered during import." });
          } else {
            throw error;
          }
        }
      }
      if (created.length) {
        await logAction(req, "csv_import", "employee", null, {
          createdCount: created.length,
          failedCount: failures.length
        });
      }
      return res.status(failures.length ? 207 : 201).json({ created, failures });
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/api/attendance", authenticate, async (req, res, next) => {
  try {
    const ids = await scopedEmployeeIds(req.user);
    const filter = ids ? { employee: { $in: ids } } : {};
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) filter.date.$lte = new Date(req.query.to);
    }
    const records = await Attendance.find(filter).sort({ date: -1 }).limit(500).lean();
    return res.json({ attendance: records });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/attendance/today", authenticate, async (req, res, next) => {
  if (!req.user.employee) return res.status(403).json({ error: "This account is not linked to an employee record." });
  try {
    const settings = await Settings.findOne({ key: "app" }).select("timezone officeRules.attendanceMode").lean();
    const timeZone = settings?.timezone || "UTC";
    const dateKey = dateKeyInTimezone(new Date(), timeZone);
    const attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: new Date(`${dateKey}T00:00:00.000Z`)
    }).lean();
    return res.json({
      date: dateKey,
      timeZone,
      attendanceMode: settings?.officeRules?.attendanceMode || "office",
      attendance
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/attendance/check-in", authenticate, async (req, res, next) => {
  if (!req.user.employee) return res.status(403).json({ error: "This account is not linked to an employee record." });
  const parsed = z.object({ workLocation: z.enum(["office", "remote"]).optional() }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  try {
    const [employee, settings] = await Promise.all([
      Employee.findOne({ _id: req.user.employee, status: "active" }).select("_id"),
      Settings.findOne({ key: "app" }).select("timezone officeRules").lean()
    ]);
    if (!employee) return res.status(403).json({ error: "An active employee record is required to check in." });
    const timeZone = settings?.timezone || "UTC";
    const rules = settings?.officeRules || { workStart: "09:00", graceMinutes: 10, attendanceMode: "office" };
    if (rules.attendanceMode === "office" && parsed.data.workLocation === "remote") {
      return res.status(400).json({ error: "Remote check-in is not enabled for this office." });
    }

    const now = new Date();
    const dateKey = dateKeyInTimezone(now, timeZone);
    const status = assignAttendanceStatus(now, timeZone, rules, parsed.data.workLocation);

    try {
      const attendance = await Attendance.create({
        employee: employee._id,
        date: new Date(`${dateKey}T00:00:00.000Z`),
        checkIn: now,
        workLocation: status === "remote" ? "remote" : "office",
        status
      });
      await logAction(req, "check_in", "attendance", attendance._id, { date: dateKey, status });
      return res.status(201).json({ attendance });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ error: "You already have an attendance record for today." });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

app.post("/api/attendance/check-out", authenticate, async (req, res, next) => {
  if (!req.user.employee) return res.status(403).json({ error: "This account is not linked to an employee record." });
  try {
    const settings = await Settings.findOne({ key: "app" }).select("timezone").lean();
    const now = new Date();
    const dateKey = dateKeyInTimezone(now, settings?.timezone || "UTC");
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    const attendance = await Attendance.findOneAndUpdate(
      {
        employee: req.user.employee,
        date,
        checkIn: { $ne: null },
        checkOut: null
      },
      { $set: { checkOut: now } },
      { new: true, runValidators: true }
    );
    if (!attendance) {
      const existing = await Attendance.exists({ employee: req.user.employee, date });
      return res.status(existing ? 409 : 400).json({
        error: existing ? "You have already checked out today." : "Check in before checking out."
      });
    }
    await logAction(req, "check_out", "attendance", attendance._id, { date: dateKey });
    return res.json({ attendance });
  } catch (error) {
    return next(error);
  }
});

const leaveDatesSchema = z.object({
  startDate: z.string().refine(isDateKey, "Enter a valid start date."),
  endDate: z.string().refine(isDateKey, "Enter a valid end date.")
}).refine((value) => value.endDate >= value.startDate, {
  message: "End date must be on or after the start date."
}).refine((value) => (
  Date.parse(`${value.endDate}T00:00:00.000Z`) - Date.parse(`${value.startDate}T00:00:00.000Z`)
  <= 365 * 24 * 60 * 60 * 1000
), {
  message: "A leave request cannot span more than 366 calendar days."
});

app.post("/api/leave-requests/estimate", authenticate, async (req, res, next) => {
  const parsed = leaveDatesSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const estimate = await leaveEstimate(parsed.data.startDate, parsed.data.endDate);
    return res.json(estimate);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/assistant/leave", authenticate, assistantLimiter, async (req, res, next) => {
  const parsed = z.object({
    action: z.enum(["prefill", "question"]),
    message: z.string().trim().min(1).max(1200)
  }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  if (!req.user.employee) {
    return res.status(403).json({ error: "This account is not linked to an employee record." });
  }
  try {
    const settings = await Settings.findOne({ key: "app" }).select("timezone").lean();
    const timezone = settings?.timezone || "UTC";
    const today = dateKeyInTimezone(new Date(), timezone);
    const policy = parsed.data.action === "question"
      ? await getEmployeeLeavePolicy(req.user.employee, Number(today.slice(0, 4)))
      : undefined;
    const result = await generateLeaveAssistantReply({
      ...parsed.data,
      context: { today, timezone, policy },
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      executeTool: async (name, args) => {
        if (name === "get_leave_policy") {
          const toolArgs = z.object({ year: z.number().int().min(1900).max(9999) }).parse(args);
          return getEmployeeLeavePolicy(req.user.employee, toolArgs.year);
        }
        if (name === "estimate_leave_days") {
          const toolArgs = leaveDatesSchema.parse(args);
          return leaveEstimate(toolArgs.startDate, toolArgs.endDate);
        }
        throw new Error("Unsupported leave assistant tool.");
      }
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return validationError(res, error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

app.get(
  "/api/leave-requests/inbox",
  authenticate,
  requireRoles("admin", "hr", "manager"),
  async (req, res, next) => {
    try {
      const ids = await scopedEmployeeIds(req.user);
      const filter = { status: "pending" };
      if (ids) filter.employee = { $in: ids };
      if (req.user.employee) {
        filter.employee = filter.employee
          ? { ...filter.employee, $ne: req.user.employee }
          : { $ne: req.user.employee };
      }
      const leaveRequests = await LeaveRequest.find(filter)
        .populate("employee", "employeeCode firstName lastName department position")
        .sort({ createdAt: 1 })
        .limit(200)
        .lean();
      return res.json({ leaveRequests });
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/api/leave-requests/mine", authenticate, async (req, res, next) => {
 if (!req.user.employee) return res.status(403).json({ error: "This account is not linked to an employee record." });
 try {
   const leaveRequests = await LeaveRequest.find({ employee: req.user.employee })
     .sort({ createdAt: -1 })
     .limit(100)
     .lean();
   return res.json({ leaveRequests });
 } catch (error) {
   return next(error);
 }
});

app.get("/api/leave-requests", authenticate, async (req, res, next) => {
  try {
    const ids = await scopedEmployeeIds(req.user);
    const filter = ids ? { employee: { $in: ids } } : {};
    const requests = await LeaveRequest.find(filter)
      .populate("employee", "employeeCode firstName lastName")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    return res.json({ leaveRequests: requests });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/leave-requests", authenticate, async (req, res, next) => {
  const schema = z.object({
    type: z.enum(["annual", "sick", "personal", "unpaid", "other"]),
    startDate: z.string().refine(isDateKey, "Enter a valid start date."),
    endDate: z.string().refine(isDateKey, "Enter a valid end date."),
    reason: z.string().trim().min(1).max(2000),
    employeeId: z.string().optional()
  }).refine((value) => value.endDate >= value.startDate, {
    message: "End date must be on or after start date."
  }).refine((value) => (
    Date.parse(`${value.endDate}T00:00:00.000Z`) - Date.parse(`${value.startDate}T00:00:00.000Z`)
    <= 365 * 24 * 60 * 60 * 1000
  ), {
    message: "A leave request cannot span more than 366 calendar days."
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  try {
    const ids = await scopedEmployeeIds(req.user);
    const targetId = req.user.role === "employee"
      ? req.user.employee
      : parsed.data.employeeId || req.user.employee;
    if (!targetId || (ids && !ids.some((id) => String(id) === String(targetId)))) {
      return res.status(403).json({ error: "You cannot create a request for that employee." });
    }
    const employeeExists = await Employee.exists({ _id: targetId });
    if (!employeeExists) return res.status(404).json({ error: "Employee not found." });

    const [estimate, settings, overlappingRequest] = await Promise.all([
      leaveEstimate(parsed.data.startDate, parsed.data.endDate),
      Settings.findOne({ key: "app" }).select("leaveQuotas").lean(),
      LeaveRequest.exists({
        employee: targetId,
        status: { $in: ["pending", "approved"] },
        startDate: { $lte: new Date(`${parsed.data.endDate}T00:00:00.000Z`) },
        endDate: { $gte: new Date(`${parsed.data.startDate}T00:00:00.000Z`) }
      })
    ]);
    if (estimate.requestedDays === 0) {
      return res.status(400).json({ error: "The selected dates contain no working days after weekends and holidays are skipped." });
    }
    if (overlappingRequest) {
      return res.status(409).json({ error: "This employee already has a pending or approved request overlapping those dates." });
    }

    const quota = settings?.leaveQuotas?.[parsed.data.type];
    if (quota !== undefined && parsed.data.type !== "other") {
      const existingRequests = await LeaveRequest.find({
        employee: targetId,
        type: parsed.data.type,
        status: { $in: ["pending", "approved"] },
        "yearlyAllocations.year": { $in: estimate.yearlyAllocations.map(({ year }) => year) }
      }).select("yearlyAllocations").lean();
      for (const allocation of estimate.yearlyAllocations) {
        const used = existingRequests.reduce((total, request) => total + (
          request.yearlyAllocations.find((entry) => entry.year === allocation.year)?.days || 0
        ), 0);
        if (used + allocation.days > quota) {
          return res.status(400).json({
            error: `This request exceeds the ${parsed.data.type} leave quota for ${allocation.year} (${used} used, ${quota} available).`
          });
        }
      }
    }

    const leaveRequest = await LeaveRequest.create({
      employee: targetId,
      type: parsed.data.type,
      startDate: new Date(`${parsed.data.startDate}T00:00:00.000Z`),
      endDate: new Date(`${parsed.data.endDate}T00:00:00.000Z`),
      reason: parsed.data.reason,
      requestedDays: estimate.requestedDays,
      yearlyAllocations: estimate.yearlyAllocations,
      excludedDates: estimate.excludedDates
    });
    await logAction(req, "create", "leave_request", leaveRequest._id);
    return res.status(201).json({ leaveRequest });
  } catch (error) {
    return next(error);
  }
});

app.patch(
  "/api/leave-requests/:id/review",
  authenticate,
  requireRoles("admin", "hr", "manager"),
  async (req, res, next) => {
    const parsed = z.object({
      status: z.enum(["approved", "rejected"]),
      reviewNote: z.string().trim().max(1000).default("")
    }).safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);

    try {
      const ids = await scopedEmployeeIds(req.user);
      const filter = { _id: req.params.id, status: "pending" };
      if (ids) filter.employee = { $in: ids };
      if (req.user.employee) {
        filter.employee = filter.employee
          ? { ...filter.employee, $ne: req.user.employee }
          : { $ne: req.user.employee };
      }
      const leaveRequest = await LeaveRequest.findOneAndUpdate(
        filter,
        {
          $set: {
            status: parsed.data.status,
            reviewNote: parsed.data.reviewNote,
            reviewedBy: req.user._id,
            reviewedAt: new Date()
          }
        },
        { new: true, runValidators: true }
      );
      if (!leaveRequest) return res.status(404).json({ error: "Pending leave request not found in your scope." });
      await logAction(req, `leave_${parsed.data.status}`, "leave_request", leaveRequest._id);
      return res.json({ leaveRequest });
    } catch (error) {
      return next(error);
    }
  }
);

const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must use YYYY-MM format.");

app.get("/api/dashboard/kpis", authenticate, async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ key: "app" }).select("timezone").lean();
    const timeZone = settings?.timezone || "UTC";
    const currentMonth = dateKeyInTimezone(new Date(), timeZone).slice(0, 7);
    const parsedMonth = monthKeySchema.safeParse(req.query.month || currentMonth);
    if (!parsedMonth.success) return validationError(res, parsedMonth.error);
    const monthKey = parsedMonth.data;
    const [year, month] = monthKey.split("-").map(Number);
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const today = dateKeyInTimezone(new Date(), timeZone);
    const ids = await scopedEmployeeIds(req.user);
    const employeeFilter = ids ? { _id: { $in: ids }, status: "active" } : { status: "active" };
    const attendanceMatch = {
      date: { $gte: monthStart, $lt: monthEnd },
      ...(ids ? { employee: { $in: ids } } : {})
    };
    const leaveMatch = {
      startDate: { $lt: monthEnd },
      endDate: { $gte: monthStart },
      ...(ids ? { employee: { $in: ids } } : {})
    };
    const todayAttendanceMatch = {
      date: new Date(`${today}T00:00:00.000Z`),
      status: { $in: ["present", "late", "remote"] },
      ...(ids ? { employee: { $in: ids } } : {})
    };
    const [employeeCount, departments, attendanceByDay, leaveByStatus, presentToday] = await Promise.all([
      Employee.countDocuments(employeeFilter),
      Employee.aggregate([
        { $match: employeeFilter },
        { $group: { _id: { $ifNull: ["$department", "Unassigned"] }, count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 12 }
      ]),
      Attendance.aggregate([
        { $match: attendanceMatch },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
            present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
            late: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } },
            remote: { $sum: { $cond: [{ $eq: ["$status", "remote"] }, 1, 0] } },
            absent: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      LeaveRequest.aggregate([
        { $match: leaveMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]),
      Attendance.countDocuments(todayAttendanceMatch)
    ]);

    const response = {
      month: monthKey,
      employeeCount,
      presentToday,
      pendingLeaves: leaveByStatus.find((item) => item._id === "pending")?.count || 0,
      departments: departments.map(({ _id, count }) => ({ department: _id, count })),
      attendanceByDay: attendanceByDay.map(({ _id, ...counts }) => ({ date: _id, ...counts })),
      leaveByStatus: leaveByStatus.map(({ _id, count }) => ({ status: _id, count }))
    };
    if (["admin", "hr"].includes(req.user.role)) {
      const latestRun = await PayrollRun.findOne({ status: "finalized" })
        .sort({ periodEnd: -1 })
        .select("monthKey currency entries.netPay")
        .lean();
      response.latestPayroll = latestRun
        ? {
          month: latestRun.monthKey,
          currency: latestRun.currency,
          netPay: roundTotal(latestRun.entries.map((entry) => entry.netPay))
        }
        : null;
    }
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

function roundTotal(values) {
  return Math.round((values.reduce((total, value) => total + value, 0) + Number.EPSILON) * 100) / 100;
}

app.get("/api/payroll-runs/mine", authenticate, async (req, res, next) => {
  if (!req.user.employee) return res.status(403).json({ error: "This account is not linked to an employee record." });
  try {
    const payrollRuns = await PayrollRun.find({
      status: "finalized",
      "entries.employee": req.user.employee
    }).sort({ periodEnd: -1 }).limit(24).lean();
    return res.json({
      payslips: payrollRuns.map((run) => ({
        payrollRunId: run._id,
        monthKey: run.monthKey,
        currency: run.currency,
        entry: run.entries.find((entry) => String(entry.employee) === String(req.user.employee))
      }))
    });
  } catch (error) {
    return next(error);
  }
});

app.get(
  "/api/payroll-runs/:runId/payslips/:employeeId.pdf",
  authenticate,
  async (req, res, next) => {
    try {
      const canAccessAll = ["admin", "hr"].includes(req.user.role);
      if (!canAccessAll && String(req.user.employee) !== req.params.employeeId) {
        return res.status(403).json({ error: "You can only access your own payslip." });
      }
      const payrollRun = await PayrollRun.findOne({
        _id: req.params.runId,
        status: "finalized",
        "entries.employee": req.params.employeeId
      }).lean();
      if (!payrollRun) return res.status(404).json({ error: "Finalized payslip not found." });
      const entry = payrollRun.entries.find((item) => String(item.employee) === req.params.employeeId);
      if (!entry) return res.status(404).json({ error: "Payslip not found." });
      return sendPayslipPdf(res, payrollRun, entry);
    } catch (error) {
      return next(error);
    }
  }
);

app.post("/api/payroll-runs", authenticate, requireRoles("admin"), async (req, res, next) => {
  const parsed = z.object({ month: monthKeySchema }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const calculated = await calculateMonthlyPayroll(parsed.data.month);
    const payrollRun = await PayrollRun.create({
      ...calculated,
      createdBy: req.user._id,
      status: "draft"
    });
    await logAction(req, "payroll_calculated", "payroll_run", payrollRun._id, {
      month: payrollRun.monthKey,
      employeeCount: payrollRun.entries.length
    });
    return res.status(201).json({ payrollRun });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: "A payroll run already exists for this month." });
    if (error instanceof RangeError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

app.post(
  "/api/payroll-runs/:runId/finalize",
  authenticate,
  requireRoles("admin"),
  async (req, res, next) => {
    try {
      const payrollRun = await PayrollRun.findOneAndUpdate(
        { _id: req.params.runId, status: "draft", lockedAt: null },
        {
          $set: {
            status: "finalized",
            lockedAt: new Date(),
            lockedBy: req.user._id
          }
        },
        { new: true, runValidators: true }
      );
      if (!payrollRun) {
        const existing = await PayrollRun.findById(req.params.runId).select("status").lean();
        return res.status(existing ? 409 : 404).json({
          error: existing ? "Payroll run is already locked or cannot be finalized." : "Payroll run not found."
        });
      }
      await logAction(req, "payroll_finalized", "payroll_run", payrollRun._id, {
        month: payrollRun.monthKey,
        employeeCount: payrollRun.entries.length
      });
      return res.json({ payrollRun });
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/api/payroll-runs", authenticate, requireRoles("admin", "hr"), async (_req, res, next) => {
  try {
    const payrollRuns = await PayrollRun.find().sort({ periodStart: -1 }).limit(100).lean();
    return res.json({ payrollRuns });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/settings", authenticate, requireRoles("admin", "hr"), async (_req, res, next) => {
  try {
    const settings = await Settings.findOne({ key: "app" }).select(
      "organizationName timezone currency setupComplete departments designations officeRules leaveQuotas holidays taxSlabs"
    ).lean();
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/settings", authenticate, requireRoles("admin"), async (req, res, next) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  try {
    const settings = await Settings.findOneAndUpdate(
      { key: "app" },
      { $set: parsed.data },
      { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
    ).select("organizationName timezone currency departments designations officeRules leaveQuotas holidays taxSlabs").lean();
    await logAction(req, "update", "settings", settings._id, {
      departments: settings.departments.length,
      designations: settings.designations.length
    });
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/audit-logs", authenticate, requireRoles("admin"), async (req, res, next) => {
  try {
    const auditLogs = await AuditLog.find()
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 100, 500))
      .lean();
    return res.json({ auditLogs });
  } catch (error) {
    return next(error);
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    return res.sendFile(path.join(clientDist, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

app.use((err, _req, res, _next) => {
  if (err?.name === "ValidationError") {
    return res.status(400).json({ error: "The submitted data is invalid." });
  }
  if (err?.name === "CastError") return res.status(400).json({ error: "Invalid identifier or value." });
  console.error(err);
  return res.status(500).json({ error: "An unexpected server error occurred." });
});

export default app;
