import test from "node:test";
import assert from "node:assert/strict";
import { parseEmployeeCsv } from "../src/employeeCsv.js";

const header = "employeeCode,firstName,lastName,email,department,position,monthlySalary,hireDate";

test("validates CSV rows and normalizes employee identifiers and emails", () => {
  const result = parseEmployeeCsv(`${header}\ne-102,Alex,River,Alex@Example.com,Engineering,"Staff, Platform Engineer",6500,2025-02-03`);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].errors.length, 0);
  assert.equal(result.rows[0].data.employeeCode, "E-102");
  assert.equal(result.rows[0].data.email, "alex@example.com");
  assert.equal(result.rows[0].data.position, "Staff, Platform Engineer");
  assert.equal(result.rows[0].data.monthlySalary, 6500);
});

test("reports invalid fields and duplicate employee identifiers in the same file", () => {
  const result = parseEmployeeCsv(
    `${header}\nE-1,Alex,River,alex@invalid,Engineering,Engineer,6000,\ne-1,Sam,Lee,sam@example.com,Finance,Analyst,5000,`
  );
  assert.match(result.rows[0].errors[0], /email/);
  assert.ok(result.rows[1].errors.includes("employeeCode: duplicated in this file."));
});

test("rejects missing headers and malformed CSV", () => {
  assert.match(parseEmployeeCsv("email,firstName\nalex@example.com,Alex").errors[0], /Missing CSV column/);
  assert.match(parseEmployeeCsv(`${header}\n"E-1,Alex,River,alex@example.com,Engineering,Engineer,5000,`).errors[0], /CSV format error/);
});

test("rejects files above the import size limit", () => {
  assert.match(parseEmployeeCsv("x".repeat(1024 * 1024 + 1)).errors[0], /1 MB/);
});

test("requires a positive monthly salary in each employee row", () => {
  const result = parseEmployeeCsv(`${header}\nE-3,Ari,Gray,ari@example.com,People,Partner,0,`);
  assert.ok(result.rows[0].errors.some((error) => error.startsWith("monthlySalary:")));
});
