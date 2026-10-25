import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { sendPayslipPdf } from "../src/payslip.js";

test("generates a PDF payslip with a safe downloadable filename", async () => {
  const response = new PassThrough();
  const headers = {};
  response.setHeader = (name, value) => { headers[name] = value; };
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  const ended = once(response, "end");
  sendPayslipPdf(response, {
    monthKey: "2026-06",
    currency: "USD",
    status: "finalized"
  }, {
    employeeCode: "E/12",
    employeeName: "Alex Example",
    monthlySalary: 5000,
    grossPay: 5000,
    deductedWorkdays: 1,
    attendanceDeduction: 200,
    taxablePay: 4800,
    annualTaxableIncome: 57600,
    annualTax: 2000,
    taxWithheld: 166.67,
    netPay: 4633.33
  });
  await ended;
  const pdf = Buffer.concat(chunks);
  assert.equal(headers["Content-Type"], "application/pdf");
  assert.equal(headers["Content-Disposition"], 'attachment; filename="payslip-E_12-2026-06.pdf"');
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
});
