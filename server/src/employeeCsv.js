import { parse } from "csv-parse/sync";
import { z } from "zod";

export const employeeInputSchema = z.object({
  employeeCode: z.string().trim().min(1).max(40).transform((value) => value.toUpperCase()),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  department: z.string().trim().min(1).max(100),
  position: z.string().trim().min(1).max(100),
  monthlySalary: z.coerce.number().finite().positive().max(1000000000),
  monthlySalary: z.coerce.number().finite().positive().max(1000000000),
  hireDate: z.preprocess(
    (value) => value === "" || value == null ? undefined : value,
    z.coerce.date().optional()
  ),
  terminationDate: z.preprocess(
    (value) => value === "" || value == null ? undefined : value,
    z.coerce.date().optional()
  )
}).refine((employee) => (
  !employee.hireDate || !employee.terminationDate || employee.terminationDate >= employee.hireDate
), {
  message: "Termination date must be on or after hire date.",
  path: ["terminationDate"]
});

const requiredHeaders = [
  "employeeCode",
  "firstName",
  "lastName",
  "email",
  "department",
  "position",
  "monthlySalary",
  "monthlySalary",
  "hireDate"
];

export function parseEmployeeCsv(csv) {
  if (typeof csv !== "string" || csv.length === 0) {
    return { rows: [], errors: ["Choose a non-empty CSV file."] };
  }
  if (Buffer.byteLength(csv, "utf8") > 1024 * 1024) {
    return { rows: [], errors: ["CSV files must be 1 MB or smaller."] };
  }

  let records;
  try {
    records = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false
    });
  } catch (error) {
    return { rows: [], errors: [`CSV format error: ${error.message}`] };
  }
  if (records.length < 2) return { rows: [], errors: ["CSV must include a header and at least one employee row."] };
  if (records.length > 1001) return { rows: [], errors: ["Import no more than 1,000 employees at a time."] };

  const headers = records[0].map((header) => String(header).trim());
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (duplicateHeaders.length) return { rows: [], errors: [`Duplicate CSV column: ${duplicateHeaders[0]}.`] };
  if (missingHeaders.length) return { rows: [], errors: [`Missing CSV column: ${missingHeaders.join(", ")}.`] };

  const seenCodes = new Set();
  const seenEmails = new Set();
  const rows = records.slice(1).map((record, index) => {
    const raw = Object.fromEntries(headers.map((header, column) => [header, record[column] ?? ""]));
    if (!headers.includes("terminationDate")) raw.terminationDate = "";
    const parsed = employeeInputSchema.safeParse(raw);
    const errors = parsed.success
      ? []
      : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    const data = parsed.success ? parsed.data : null;

    const code = String(raw.employeeCode || "").trim().toUpperCase();
    const email = String(raw.email || "").trim().toLowerCase();
    if (code && seenCodes.has(code)) errors.push("employeeCode: duplicated in this file.");
    if (code) seenCodes.add(code);
    if (email && seenEmails.has(email)) errors.push("email: duplicated in this file.");
    if (email) seenEmails.add(email);
    return { row: index + 2, data, errors };
  });
  return { rows, errors: [] };
}
