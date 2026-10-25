# People Ops

A starter people-operations app with a React/Vite setup and sign-in experience, an Express API, and MongoDB/Mongoose data models.

## Requirements

- Node.js 20+
- MongoDB 6+

## Run locally

1. Copy `server/.env.example` to `server/.env`; set a unique `JWT_SECRET` of at least 32 characters and your MongoDB URI.
2. In `server/`, run `npm install` and then `npm run dev`.
3. In `client/`, run `npm install` and then `npm run dev`.
4. Open the Vite URL (normally `http://localhost:5173`). The first visitor is guided through organization setup and Admin account creation.

The Vite development server proxies `/api` to `http://localhost:4000`. Set `CLIENT_URL` to the deployed frontend origin in production.

## Render deployment

This repository includes a Render Blueprint (`render.yaml`) that builds the frontend and serves it from the Express service, so the app and API share one origin. In Render, create a Blueprint from this repository and set the requested `MONGODB_URI` and `GEMINI_API_KEY` environment variables directly in Render; do not commit credentials. Provision MongoDB separately with a hosted MongoDB provider such as MongoDB Atlas free tier, allow the Render service to connect in the database network-access rules, and use the provider's application connection string. Render's free web service can sleep when idle and may take time to wake for a demo.

## Data model

The Mongoose models cover users, employees, attendance, leave requests, payroll runs, singleton organization settings, and audit logs. References and enum constraints define ownership and status; attendance records are unique per employee and date.

## Authentication and access

- Passwords are hashed with bcrypt; API tokens are signed JWTs and expire after `JWT_EXPIRES_IN` (default `8h`).
- Set a long, random JWT secret and use HTTPS in production. Login attempts are rate limited.
- Roles are `admin`, `hr`, `manager`, and `employee`. Admin/HR can access organization-wide employee data; managers are scoped to themselves and their direct reports; employees are scoped to their own employee record.
- Payroll and settings routes are Admin/HR only; audit logs are Admin only. Leave review is restricted to Admin/HR and managers within their employee scope.
- The initial setup endpoint is available only until an Admin is created and setup is marked complete.

## API

- `GET /api/health`
- `GET /api/auth/setup-status`, `POST /api/auth/setup`
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`
- `GET /api/employees`, `POST /api/employees`, `POST /api/employees/import/validate`, `POST /api/employees/import`
- `GET /api/attendance`, `GET /api/attendance/today`, `POST /api/attendance/check-in`, `POST /api/attendance/check-out`
- `GET /api/leave-requests`, `GET /api/leave-requests/mine`, `GET /api/leave-requests/inbox`, `POST /api/leave-requests/estimate`, `POST /api/leave-requests`, `PATCH /api/leave-requests/:id/review`
- `GET /api/payroll-runs`, `GET /api/settings`, `PATCH /api/settings`, `GET /api/audit-logs`
- `POST /api/assistant/leave` (authenticated; `action` is `prefill` or `question`, with a natural-language `message`)
- `POST /api/payroll-runs`, `POST /api/payroll-runs/:runId/finalize`, `GET /api/payroll-runs/mine`, `GET /api/payroll-runs/:runId/payslips/:employeeId.pdf`
- `GET /api/dashboard/kpis`

Admins can configure office hours, attendance mode, work days, departments, designations, annual leave quotas, public holidays, and progressive annual tax slabs in the Office settings screen and first-run wizard. Tax slabs contain ascending `upperLimit` values (the final slab is open-ended), `ratePercent`, and `baseTax`. Payroll annualizes the month's taxable pay, applies the configured progressive formula, and withholds one twelfth of annual tax; these generic example slabs are not jurisdiction-specific tax advice. Leave date ranges are capped at 366 calendar days. Admin and HR users can onboard employees or validate a CSV before importing it. CSV columns are `employeeCode,firstName,lastName,email,department,position,monthlySalary,hireDate`; optional `terminationDate` is also accepted. `monthlySalary` is gross pay per month and employment dates use `YYYY-MM-DD` or may be blank. Each created login receives a cryptographically generated temporary password, shown once in the response, and must change it before using other API routes.

Smart Leave uses the Google Gemini API from the backend (default model: `gemini-2.5-flash`). Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) in `server/.env`; never place the key in the frontend. Free-tier availability and quotas depend on Google's current terms, region, and account. The assistant endpoint is rate limited and only available to authenticated accounts linked to an employee. Prefill results are draft suggestions applied to editable fields and are never submitted automatically. Policy Q&A is bounded to organization-configured leave rules, balances, and the existing workday estimator; it is not HR, medical, or legal advice. User messages and the minimum policy context needed to answer are sent to Google's hosted API, so configure the feature in accordance with your organization's data-handling requirements. If the key is unset, the normal leave form continues to work and assistant requests return a configuration error.

Employees can check in and out once per organization-local calendar day. Check-in status is assigned from the configured timezone, office start time, grace period, and attendance mode. Leave requests calculate chargeable workdays from configured workdays, excluding weekends/non-workdays and listed public holidays; overlaps and configured annual quotas are checked before submission. Admin/HR have an organization-wide approval inbox, while managers can review requests from direct reports (not their own requests).

Monthly payroll prorates gross salary by calendar days employed, deducts recorded absent workdays and approved unpaid leave, and does not deduct approved paid leave. Admins can create draft runs, inspect entries, and finalize them; finalization is confirmed, locks the run, and exposes downloadable PDF payslips. Dashboard KPI data respects role/employee scopes and visualizes attendance trend, leave status, and department headcount.

Run schema tests with `cd server; npm test`.
