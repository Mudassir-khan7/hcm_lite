import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleCheck,
  CircleX,
  Clipboard,
  Clock3,
  Download,
  FileSpreadsheet,
  Inbox,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users
} from "lucide-react";
const DashboardCharts = lazy(() => import("./DashboardCharts.jsx"));

const defaultTaxSlabs = [
  { upperLimit: 25000, ratePercent: 0, baseTax: 0 },
  { upperLimit: 75000, ratePercent: 10, baseTax: 0 },
  { upperLimit: null, ratePercent: 20, baseTax: 5000 }
];

const emptySetup = {
  organizationName: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  currency: "USD",
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  taxSlabs: defaultTaxSlabs
};

async function api(path, options = {}, token) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.data = data;
    throw error;
  }
  return data;
}

async function apiCsv(path, csv, token) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "text/csv", Authorization: `Bearer ${token}` },
    body: csv
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.data = data;
    throw error;
  }
  return data;
}

function App() {
  const [setupRequired, setSetupRequired] = useState(null);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("people-ops-token"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const status = await api("/api/auth/setup-status");
        if (cancelled) return;
        setSetupRequired(status.setupRequired);
        if (token) {
          try {
            const result = await api("/api/auth/me", {}, token);
            if (!cancelled) setUser(result.user);
          } catch {
            localStorage.removeItem("people-ops-token");
            if (!cancelled) setToken(null);
          }
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    initialize();
    return () => { cancelled = true; };
  }, []);

  async function submitAuth(path, payload) {
    setError("");
    const result = await api(path, { method: "POST", body: JSON.stringify(payload) });
    localStorage.setItem("people-ops-token", result.token);
    setToken(result.token);
    setUser(result.user);
    setSetupRequired(false);
  }

  function signOut() {
    localStorage.removeItem("people-ops-token");
    setToken(null);
    setUser(null);
  }

  if (loading) return <main className="loading">Preparing your workspace…</main>;
  if (error && setupRequired === null) {
    return <main className="loading"><p className="alert">{error}</p><p>Check that the People Ops API is running.</p></main>;
  }
  if (user) return <Dashboard user={user} token={token} onUserChange={setUser} onSignOut={signOut} />;

  return (
    <main className="auth-layout">
      <section className="intro-panel">
        <div className="brand"><span className="brand-icon"><Users size={20} /></span> people<span>ops</span></div>
        <div className="intro-copy">
          <span className="eyebrow">A better way to work</span>
          <h1>People-first operations, <em>all in one place.</em></h1>
          <p>Bring your team, time, and people operations together in one thoughtfully simple workspace.</p>
        </div>
        <div className="intro-footer"><ShieldCheck size={16} /> Secure access for your organization</div>
      </section>
      <section className="form-panel">
        <div className="form-wrap">
          {setupRequired
            ? <SetupWizard onSubmit={submitAuth} error={error} setError={setError} />
            : <LoginForm onSubmit={submitAuth} error={error} setError={setError} />}
        </div>
      </section>
    </main>
  );
}

function SetupWizard({ onSubmit, error, setError }) {
  const [step, setStep] = useState(1);
  const [values, setValues] = useState(emptySetup);
  const [submitting, setSubmitting] = useState(false);
  const update = (event) => setValues({ ...values, [event.target.name]: event.target.value });
  const goNext = (event) => {
    event.preventDefault();
    setError("");
    if (values.organizationName.trim().length < 2) return setError("Enter your organization name.");
    setStep(2);
  };
  function goTaxStep(event) {
    event.preventDefault();
    setError("");
    setStep(3);
  }
  async function finish(event) {
    event.preventDefault();
    setError("");
    if (values.firstName.trim().length === 0 || values.lastName.trim().length === 0) return setError("Enter the Admin's full name.");
    if (values.password.length < 12) return setError("Use a password with at least 12 characters.");
    setSubmitting(true);
    try {
      await onSubmit("/api/auth/setup", values);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="form-heading">
        <div className="step-label">INITIAL SETUP <span>·</span> STEP {step} OF 3</div>
        <div className="step-progress"><i className={step >= 1 ? "complete" : ""} /><i className={step === 2 ? "active" : step > 2 ? "complete" : ""} /><i className={step === 3 ? "active" : ""} /></div>
        <h2>{step === 1 ? "Set up your workspace" : step === 2 ? "Create your Admin account" : "Configure annual tax slabs"}</h2>
        <p>{step === 1 ? "A few details to make this space yours." : step === 2 ? "This account has full control of your workspace." : "Set progressive annual tax brackets in your organization currency."}</p>
      </div>
      {step === 1 ? (
        <form onSubmit={goNext} className="fields">
          <label>Organization name<input name="organizationName" value={values.organizationName} onChange={update} placeholder="e.g. Northstar Studio" autoFocus required maxLength={120} /></label>
          <div className="field-row">
            <label>Timezone<input name="timezone" value={values.timezone} onChange={update} required maxLength={64} /></label>
            <label>Currency<select name="currency" value={values.currency} onChange={update}><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound</option><option value="CAD">CAD — Canadian Dollar</option><option value="AUD">AUD — Australian Dollar</option></select></label>
          </div>
          {error && <p className="alert">{error}</p>}
          <button className="primary" type="submit">Continue <ArrowRight size={17} /></button>
          <p className="fine-print"><LockKeyhole size={14} /> Your organization data stays private and secure.</p>
        </form>
      ) : step === 2 ? (
        <form onSubmit={goTaxStep} className="fields">
          <div className="field-row">
            <label>First name<input name="firstName" value={values.firstName} onChange={update} placeholder="Jordan" autoFocus required maxLength={80} /></label>
            <label>Last name<input name="lastName" value={values.lastName} onChange={update} placeholder="Lee" required maxLength={80} /></label>
          </div>
          <label>Admin email<input name="email" type="email" value={values.email} onChange={update} placeholder="you@company.com" autoComplete="email" required maxLength={254} /></label>
          <label>Password<input name="password" type="password" value={values.password} onChange={update} placeholder="At least 12 characters" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
          {error && <p className="alert">{error}</p>}
          <div className="button-row">
            <button className="secondary" type="button" onClick={() => { setError(""); setStep(1); }}><ArrowLeft size={16} /> Back</button>
            <button className="primary" type="submit">Continue <ArrowRight size={17} /></button>
          </div>
          <p className="fine-print"><LockKeyhole size={14} /> Passwords are encrypted before they are stored.</p>
        </form>
      ) : (
        <form onSubmit={finish} className="fields">
          <p className="tax-setup-note">These are editable example values, not jurisdiction-specific tax advice. Confirm the income limits, rates, and base taxes with your payroll administrator before completing setup.</p>
          <TaxSlabEditor slabs={values.taxSlabs} onChange={(taxSlabs) => setValues({ ...values, taxSlabs })} />
          {error && <p className="alert">{error}</p>}
          <div className="button-row">
            <button className="secondary" type="button" onClick={() => { setError(""); setStep(2); }}><ArrowLeft size={16} /> Back</button>
            <button className="primary" type="submit" disabled={submitting}>{submitting ? "Creating workspace…" : "Save slabs & finish"} <ArrowRight size={17} /></button>
          </div>
        </form>
      )}
    </>
  );
}

function LoginForm({ onSubmit, error, setError }) {
  const [values, setValues] = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onSubmit("/api/auth/login", values);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <>
      <div className="form-heading">
        <div className="step-label">WELCOME BACK</div>
        <h2>Sign in to your workspace</h2>
        <p>Enter your account details to continue.</p>
      </div>
      <form onSubmit={submit} className="fields">
        <label>Email address<input type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} placeholder="you@company.com" autoComplete="email" autoFocus required /></label>
        <label>Password<input type="password" value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} placeholder="Your password" autoComplete="current-password" required /></label>
        {error && <p className="alert">{error}</p>}
        <button className="primary" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"} <ArrowRight size={17} /></button>
      </form>
    </>
  );
}

function Dashboard({ user, token, onUserChange, onSignOut }) {
  const [page, setPage] = useState(user.forcePasswordChange ? "password" : "home");
  const isAdmin = user.role === "admin";
  const canManageEmployees = isAdmin || user.role === "hr";

  return (
    <main className="dashboard">
      <header className="topbar">
        <div className="brand"><span className="brand-icon"><Users size={20} /></span> people<span>ops</span></div>
        <div className="topbar-actions">
          {!user.forcePasswordChange && (
            <nav className="dashboard-nav" aria-label="Workspace">
              <button className={page === "home" ? "selected" : ""} onClick={() => setPage("home")}>Overview</button>
              {user.employeeId && <button className={page === "attendance" ? "selected" : ""} onClick={() => setPage("attendance")}><Clock3 size={15} /> Attendance</button>}
              <button className={page === "leave" ? "selected" : ""} onClick={() => setPage("leave")}><CalendarDays size={15} /> Leave</button>
              {["admin", "hr", "manager"].includes(user.role) && <button className={page === "inbox" ? "selected" : ""} onClick={() => setPage("inbox")}><Inbox size={15} /> Approvals</button>}
              {["admin", "hr"].includes(user.role) && <button className={page === "payroll" ? "selected" : ""} onClick={() => setPage("payroll")}><Download size={15} /> Payroll</button>}
              {user.employeeId && <button className={page === "payslips" ? "selected" : ""} onClick={() => setPage("payslips")}><Download size={15} /> Payslips</button>}
              {canManageEmployees && <button className={page === "onboard" ? "selected" : ""} onClick={() => setPage("onboard")}><UserPlus size={15} /> Add employee</button>}
              {canManageEmployees && <button className={page === "csv" ? "selected" : ""} onClick={() => setPage("csv")}><FileSpreadsheet size={15} /> CSV import</button>}
              {isAdmin && <button className={page === "settings" ? "selected" : ""} onClick={() => setPage("settings")}><Settings2 size={15} /> Office settings</button>}
            </nav>
          )}
          <button className="signout" onClick={onSignOut}><LogOut size={16} /> Sign out</button>
        </div>
      </header>
      <section className="dashboard-content">
        {user.forcePasswordChange
          ? <PasswordChange token={token} onComplete={() => { onUserChange({ ...user, forcePasswordChange: false }); setPage("home"); }} />
          : page === "settings" && isAdmin
            ? <OfficeSettings token={token} />
            : page === "onboard" && canManageEmployees
              ? <EmployeeOnboarding token={token} />
              : page === "csv" && canManageEmployees
                ? <EmployeeCsvImport token={token} />
                : page === "attendance"
                  ? <AttendanceCard token={token} employeeId={user.employeeId} />
                  : page === "leave"
                    ? <LeaveCenter token={token} employeeId={user.employeeId} />
                    : page === "inbox" && ["admin", "hr", "manager"].includes(user.role)
                      ? <ApprovalInbox token={token} />
                      : page === "payroll" && ["admin", "hr"].includes(user.role)
                        ? <PayrollWorkspace token={token} canFinalize={isAdmin} />
                        : page === "payslips" && user.employeeId
                          ? <MyPayslips token={token} />
                          : page === "home"
                            ? <DashboardOverview token={token} user={user} />
                    : <section className="welcome-card">
                    <span className="welcome-mark"><Check size={21} /></span>
                    <span className="eyebrow">WORKSPACE READY</span>
                    <h1>Welcome to People Ops.</h1>
                    <p>Your workspace is set up and ready. You’re signed in as <strong>{user.email}</strong>.</p>
                    <div className="role-badge">{user.role} account</div>
                  </section>}
      </section>
    </main>
  );
}

function AttendanceCard({ token, employeeId }) {
  const [today, setToday] = useState(null);
  const [workLocation, setWorkLocation] = useState("office");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    const result = await api("/api/attendance/today", {}, token);
    setToday(result);
  }
  useEffect(() => {
    refresh()
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function punch(action) {
    setSubmitting(true);
    setError("");
    try {
      const result = await api(`/api/attendance/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "check-in" ? { workLocation } : {})
      }, token);
      setToday((current) => ({ ...current, attendance: result.attendance }));
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.message.includes("already")) {
        try { await refresh(); } catch (refreshError) { setError(refreshError.message); }
      }
    } finally {
      setSubmitting(false);
    }
  }

  const record = today?.attendance;
  const time = (value) => value
    ? new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: today?.timeZone || undefined
    }).format(new Date(value))
    : "—";

  if (loading) return <section className="workspace-card">Loading today’s attendance…</section>;
  if (!employeeId) {
    return <section className="workspace-card"><p className="alert">This login is not linked to an employee record, so attendance check-in is unavailable.</p></section>;
  }
  return (
    <section className="workspace-card narrow-card">
      <div className="section-kicker">ATTENDANCE · {today?.date || ""}</div>
      <h1>Your workday</h1>
      <p className="section-description">Check in once when you start, then check out when your workday is complete. Attendance status is assigned from your office schedule.</p>
      <div className="attendance-status">
        <span className={`status-dot ${record?.checkOut ? "done" : record?.checkIn ? "active" : ""}`} />
        <strong>{record ? record.status : "Not checked in"}</strong>
        {record?.checkOut && <span className="status-pill">Complete</span>}
      </div>
      <div className="punch-times">
        <div><span>CHECK IN</span><strong>{time(record?.checkIn)}</strong></div>
        <div><span>CHECK OUT</span><strong>{time(record?.checkOut)}</strong></div>
      </div>
      {today?.attendanceMode === "hybrid" && !record?.checkIn && (
        <label className="location-select">Today’s work location
          <select value={workLocation} onChange={(event) => setWorkLocation(event.target.value)}>
            <option value="office">Office</option><option value="remote">Remote</option>
          </select>
        </label>
      )}
      {today?.attendanceMode === "remote" && <p className="fine-print">Your organization is configured for remote work.</p>}
      {error && <p className="alert">{error}</p>}
      <div className="punch-actions">
        {!record?.checkIn
          ? <button className="primary" disabled={submitting} onClick={() => punch("check-in")}>{submitting ? "Checking in…" : "Check in"} <Clock3 size={17} /></button>
          : !record.checkOut
            ? <button className="primary" disabled={submitting} onClick={() => punch("check-out")}>{submitting ? "Checking out…" : "Check out"} <ArrowRight size={17} /></button>
            : <p className="success-message"><CircleCheck size={16} /> Your attendance for today is complete.</p>}
      </div>
      <p className="fine-print">One attendance record is allowed per employee per organization-local calendar day.</p>
    </section>
  );
}

function LeaveCenter({ token, employeeId }) {
  const [values, setValues] = useState({ type: "annual", startDate: "", endDate: "", reason: "" });
  const [estimate, setEstimate] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [assistantMessage, setAssistantMessage] = useState("");
  const [assistantAnswer, setAssistantAnswer] = useState("");
  const [assistantError, setAssistantError] = useState("");
  const [assistantAction, setAssistantAction] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(Boolean(employeeId));

  async function refresh() {
    const data = await api("/api/leave-requests/mine", {}, token);
    setRequests(data.leaveRequests);
  }
  useEffect(() => {
    if (!employeeId) return;
    refresh()
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [token, employeeId]);

  async function calculate() {
    setEstimate(null);
    setError("");
    setEstimating(true);
    try {
      setEstimate(await api("/api/leave-requests/estimate", {
        method: "POST",
        body: JSON.stringify({ startDate: values.startDate, endDate: values.endDate })
      }, token));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setEstimating(false);
    }
  }

  async function askAssistant(action) {
    setAssistantAction(action);
    setAssistantError("");
    setAssistantAnswer("");
    try {
      const result = await api("/api/assistant/leave", {
        method: "POST",
        body: JSON.stringify({ action, message: assistantMessage })
      }, token);
      if (action === "prefill") {
        const suggestion = result.suggestion;
        setValues((current) => ({
          ...current,
          ...(suggestion.type !== "unspecified" ? { type: suggestion.type } : {}),
          ...(suggestion.startDate ? { startDate: suggestion.startDate } : {}),
          ...(suggestion.endDate ? { endDate: suggestion.endDate } : {}),
          ...(suggestion.reason ? { reason: suggestion.reason } : {})
        }));
        setEstimate(null);
        setAssistantAnswer("Draft fields updated. Review and edit them before submitting.");
      } else {
        setAssistantAnswer(result.answer);
      }
    } catch (requestError) {
      setAssistantError(requestError.message);
    } finally {
      setAssistantAction("");
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const result = await api("/api/leave-requests", {
        method: "POST",
        body: JSON.stringify(values)
      }, token);
      setSuccess(`Leave request submitted for ${result.leaveRequest.requestedDays} working day${result.leaveRequest.requestedDays === 1 ? "" : "s"}.`);
      setValues({ type: "annual", startDate: "", endDate: "", reason: "" });
      setEstimate(null);
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!employeeId) {
    return <section className="workspace-card"><div className="section-kicker">TIME OFF</div><h1>Leave requests</h1><p className="section-description">This login is not linked to an employee record. Ask an Admin to link your account before submitting leave.</p></section>;
  }
  return (
    <section className="workspace-card">
      <div className="section-kicker">TIME OFF · REQUESTS</div>
      <h1>Request leave</h1>
      <p className="section-description">Working days are calculated from your organization’s schedule. Weekends and configured holidays are excluded automatically.</p>
      <form className="fields workspace-form" onSubmit={submit}>
        <div className="workspace-grid">
          <label>Leave type<select value={values.type} onChange={(event) => { setValues({ ...values, type: event.target.value }); setEstimate(null); }}><option value="annual">Annual leave</option><option value="sick">Sick leave</option><option value="personal">Personal leave</option><option value="unpaid">Unpaid leave</option><option value="other">Other</option></select></label>
          <span />
          <label>First day<input type="date" value={values.startDate} onChange={(event) => { setValues({ ...values, startDate: event.target.value }); setEstimate(null); }} required /></label>
          <label>Last day<input type="date" value={values.endDate} min={values.startDate || undefined} onChange={(event) => { setValues({ ...values, endDate: event.target.value }); setEstimate(null); }} required /></label>
        </div>
        <label>Reason<textarea rows="3" value={values.reason} onChange={(event) => setValues({ ...values, reason: event.target.value })} required maxLength={2000} /></label>
        <div className="leave-assistant">
          <div className="assistant-heading"><Sparkles size={17} /><strong>Smart Leave</strong><span>Optional AI assistance</span></div>
          <label>Describe your leave or ask about the configured policy
            <textarea rows="2" value={assistantMessage} onChange={(event) => setAssistantMessage(event.target.value)} maxLength={1200} placeholder="e.g. I need annual leave next Monday and Tuesday" />
          </label>
          <div className="assistant-actions">
            <button type="button" className="secondary" disabled={!assistantMessage.trim() || Boolean(assistantAction)} onClick={() => askAssistant("prefill")}>
              <Sparkles size={15} /> {assistantAction === "prefill" ? "Preparing…" : "Suggest form details"}
            </button>
            <button type="button" className="secondary" disabled={!assistantMessage.trim() || Boolean(assistantAction)} onClick={() => askAssistant("question")}>
              <MessageCircle size={15} /> {assistantAction === "question" ? "Checking…" : "Ask policy"}
            </button>
          </div>
          {assistantError && <p className="alert">{assistantError}</p>}
          {assistantAnswer && <p className="assistant-answer" aria-live="polite">{assistantAnswer}</p>}
          <p className="fine-print">Suggestions are drafts only. Verify all fields; the assistant cannot approve or submit leave.</p>
        </div>
        <div className="leave-actions">
          <button type="button" className="secondary" disabled={!values.startDate || !values.endDate || estimating} onClick={calculate}>{estimating ? "Calculating…" : "Calculate working days"}</button>
          {estimate && <span className="estimate-label">{estimate.requestedDays} working day{estimate.requestedDays === 1 ? "" : "s"}</span>}
        </div>
        {estimate?.excludedDates?.length > 0 && <p className="excluded-dates">{estimate.excludedDates.map(({ date, reason, name }) => `${date} (${reason === "holiday" ? name || "holiday" : "weekend"})`).join(" · ")} skipped</p>}
        {error && <p className="alert">{error}</p>}
        {success && <p className="success-message">{success}</p>}
        <button className="primary" disabled={submitting}>{submitting ? "Submitting…" : "Submit leave request"} <ArrowRight size={17} /></button>
      </form>
      <div className="settings-section leave-history">
        <h2>My requests</h2>
        {loading ? <p className="section-description">Loading your requests…</p>
          : requests.length === 0 ? <p className="section-description">No leave requests yet.</p>
            : <div className="request-list">{requests.map((request) => (
              <article className="request-row" key={request._id}>
                <div><strong>{request.type} leave · {request.requestedDays} day{request.requestedDays === 1 ? "" : "s"}</strong><span>{new Date(request.startDate).toISOString().slice(0, 10)} – {new Date(request.endDate).toISOString().slice(0, 10)}</span></div>
                <span className={`request-status ${request.status}`}>{request.status}</span>
              </article>
            ))}</div>}
      </div>
    </section>
  );
}

function ApprovalInbox({ token }) {
  const [requests, setRequests] = useState([]);
  const [notes, setNotes] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState("");

  async function refresh() {
    const data = await api("/api/leave-requests/inbox", {}, token);
    setRequests(data.leaveRequests);
  }
  useEffect(() => {
    refresh()
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function review(requestId, status) {
    setActingOn(requestId);
    setError("");
    try {
      await api(`/api/leave-requests/${requestId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ status, reviewNote: notes[requestId] || "" })
      }, token);
      setRequests((current) => current.filter((request) => request._id !== requestId));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setActingOn("");
    }
  }

  return (
    <section className="workspace-card">
      <div className="section-kicker">PEOPLE · APPROVALS</div>
      <h1>Leave approval inbox</h1>
      <p className="section-description">Review pending requests in your approval scope. Managers can review direct reports; Admin and HR can review organization-wide requests.</p>
      {error && <p className="alert">{error}</p>}
      {loading ? <p className="section-description">Loading pending requests…</p>
        : requests.length === 0 ? <div className="empty-inbox"><CircleCheck size={23} /><strong>You’re all caught up.</strong><span>No pending leave requests in your inbox.</span></div>
          : <div className="approval-list">{requests.map((request) => {
            const employee = request.employee || {};
            return <article className="approval-card" key={request._id}>
              <div className="approval-heading">
                <div><strong>{employee.firstName} {employee.lastName}</strong><span>{employee.employeeCode} · {employee.department || "No department"}</span></div>
                <span className="request-status pending">Pending</span>
              </div>
              <div className="approval-details">
                <span><b>{request.type} leave</b> · {request.requestedDays} working day{request.requestedDays === 1 ? "" : "s"}</span>
                <span>{new Date(request.startDate).toISOString().slice(0, 10)} – {new Date(request.endDate).toISOString().slice(0, 10)}</span>
              </div>
              {request.excludedDates?.length > 0 && <p className="excluded-dates">{request.excludedDates.length} weekend/holiday date{request.excludedDates.length === 1 ? "" : "s"} excluded from quota.</p>}
              <p className="approval-reason">{request.reason}</p>
              <label className="review-note">Review note (optional)<textarea rows="2" maxLength={1000} value={notes[request._id] || ""} onChange={(event) => setNotes({ ...notes, [request._id]: event.target.value })} /></label>
              <div className="approval-actions">
                <button className="approve-button" disabled={actingOn === request._id} onClick={() => review(request._id, "approved")}><CircleCheck size={16} /> Approve</button>
                <button className="reject-button" disabled={actingOn === request._id} onClick={() => review(request._id, "rejected")}><CircleX size={16} /> Reject</button>
              </div>
            </article>;
          })}</div>}
    </section>
  );
}

function DashboardOverview({ token, user }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/api/dashboard/kpis?month=${month}`, {}, token)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((requestError) => { if (!cancelled) setError(requestError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, token]);

  if (loading && !data) return <section className="workspace-card">Loading your dashboard…</section>;
  const attendanceSummary = (data?.attendanceByDay || []).reduce((summary, day) => ({
    present: summary.present + day.present,
    late: summary.late + day.late,
    remote: summary.remote + day.remote,
    absent: summary.absent + day.absent
  }), { present: 0, late: 0, remote: 0, absent: 0 });
  const attendancePie = Object.entries(attendanceSummary)
    .filter(([, count]) => count > 0)
    .map(([name, value]) => ({ name, value }));
  const formatMoney = (amount, currency) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
    } catch {
      return `${currency} ${Math.round(amount).toLocaleString()}`;
    }
  };
  return (
    <section className="dashboard-overview">
      <div className="overview-heading">
        <div><div className="section-kicker">PEOPLE OPS · OVERVIEW</div><h1>Good to see you, {user.firstName || user.email.split("@")[0]}.</h1><p>Here’s what’s happening across your workspace.</p></div>
        <label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      </div>
      {error && <p className="alert">{error}</p>}
      <div className="kpi-grid">
        <KpiCard label="Active employees" value={data?.employeeCount ?? "—"} />
        <KpiCard label="Checked in today" value={data?.presentToday ?? "—"} />
        <KpiCard label="Pending leave" value={data?.pendingLeaves ?? "—"} />
        {data?.latestPayroll && <KpiCard label={`Latest payroll · ${data.latestPayroll.month}`} value={formatMoney(data.latestPayroll.netPay, data.latestPayroll.currency)} />}
      </div>
      <Suspense fallback={<div className="empty-chart">Loading charts…</div>}>
        <DashboardCharts data={data} />
      </Suspense>
    </section>
  );
}

function KpiCard({ label, value }) {
  return <article className="kpi-card"><span>{label}</span><strong>{value}</strong></article>;
}

async function downloadPayslip(token, payrollRunId, employeeId) {
  const response = await fetch(`/api/payroll-runs/${payrollRunId}/payslips/${employeeId}.pdf`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not download payslip.");
  }
  const file = await response.blob();
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `payslip-${payrollRunId}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function MyPayslips({ token }) {
  const [payslips, setPayslips] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState("");
  useEffect(() => {
    api("/api/payroll-runs/mine", {}, token)
      .then(({ payslips: results }) => setPayslips(results))
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [token]);
  async function download(slip) {
    const id = `${slip.payrollRunId}`;
    setDownloading(id);
    setError("");
    try {
      await downloadPayslip(token, id, slip.entry.employee);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDownloading("");
    }
  }
  return (
    <section className="workspace-card">
      <div className="section-kicker">PAYROLL · DOCUMENTS</div><h1>My payslips</h1>
      <p className="section-description">Download PDF payslips from finalized payroll runs.</p>
      {error && <p className="alert">{error}</p>}
      {loading ? <p className="section-description">Loading payslips…</p>
        : payslips.length === 0 ? <div className="empty-inbox"><Download size={22} /><strong>No payslips yet.</strong><span>Your Admin will publish a payslip after finalizing payroll.</span></div>
        : <div className="payroll-table-wrap"><table className="payroll-table"><thead><tr><th>Pay month</th><th>Days employed</th><th>Gross pay</th><th>Tax</th><th>Net pay</th><th /></tr></thead><tbody>{payslips.map((slip) => <tr key={slip.payrollRunId}><td>{slip.monthKey}</td><td>{slip.entry.proratedDays}</td><td>{formatCurrency(slip.entry.grossPay, slip.currency)}</td><td>{formatCurrency(slip.entry.taxWithheld, slip.currency)}</td><td><strong>{formatCurrency(slip.entry.netPay, slip.currency)}</strong></td><td><button className="download-button" disabled={downloading === `${slip.payrollRunId}`} onClick={() => download(slip)}><Download size={15} /> PDF</button></td></tr>)}</tbody></table></div>}
    </section>
  );
}

function formatCurrency(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

function PayrollWorkspace({ token, canFinalize }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [downloading, setDownloading] = useState("");

  async function refresh() {
    const data = await api("/api/payroll-runs", {}, token);
    setRuns(data.payrollRuns);
  }
  useEffect(() => {
    refresh()
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [token]);
  async function calculate() {
    setWorking("calculate");
    setError("");
    try {
      await api("/api/payroll-runs", { method: "POST", body: JSON.stringify({ month }) }, token);
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking("");
    }
  }
  async function finalize(runId) {
    const run = runs.find((item) => item._id === runId);
    if (!window.confirm(`Finalize ${run?.monthKey || "this payroll run"}? This locks the run and publishes employee payslips.`)) return;
    setWorking(runId);
    setError("");
    try {
      await api(`/api/payroll-runs/${runId}/finalize`, { method: "POST", body: "{}" }, token);
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking("");
    }
  }
  async function download(run, entry) {
    setDownloading(`${run._id}-${entry.employee}`);
    setError("");
    try {
      await downloadPayslip(token, run._id, entry.employee);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDownloading("");
    }
  }
  return (
    <section className="workspace-card payroll-workspace">
      <div className="section-kicker">PAYROLL · ADMINISTRATION</div><h1>Payroll runs</h1>
      <p className="section-description">Calculate monthly gross pay, attendance deductions, and annualized progressive tax. Finalizing locks a run and publishes employee payslips.</p>
      {canFinalize && <div className="payroll-controls"><label>Payroll month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button className="primary" disabled={working === "calculate"} onClick={calculate}>{working === "calculate" ? "Calculating…" : "Calculate payroll"} <ArrowRight size={16} /></button></div>}
      <p className="tax-setup-note">Proration uses calendar days employed in the month. Attendance deductions use recorded absent workdays and approved unpaid leave; approved paid leave is not deducted. Annual tax is calculated on annualized monthly taxable pay and withheld as 1/12 of annual tax.</p>
      {error && <p className="alert">{error}</p>}
      {loading ? <p className="section-description">Loading payroll runs…</p>
        : runs.length === 0 ? <div className="empty-inbox"><Download size={22} /><strong>No payroll runs yet.</strong><span>Calculate a monthly run to review entries before finalizing.</span></div>
          : <div className="run-list">{runs.map((run) => (
            <details className="run-card" key={run._id} open={runs.length === 1}>
              <summary><span><strong>{run.monthKey}</strong><small>{run.entries.length} employees · {run.currency}</small></span><span className={`request-status ${run.status === "finalized" ? "approved" : "pending"}`}>{run.status === "finalized" ? "Locked / finalized" : run.status}</span></summary>
              {run.lockedAt && <p className="locked-note">Locked on {new Date(run.lockedAt).toLocaleString()}</p>}
              <div className="payroll-table-wrap"><table className="payroll-table"><thead><tr><th>Employee</th><th>Days employed</th><th>Prorated gross</th><th>Absent days</th><th>Attendance deduction</th><th>Tax</th><th>Net pay</th><th /></tr></thead><tbody>{run.entries.map((entry) => <tr key={entry.employee}><td><strong>{entry.employeeName}</strong><small>{entry.employeeCode}</small></td><td>{entry.proratedDays}</td><td>{formatCurrency(entry.grossPay, run.currency)}</td><td>{entry.deductedWorkdays}</td><td>{formatCurrency(entry.attendanceDeduction, run.currency)}</td><td>{formatCurrency(entry.taxWithheld, run.currency)}</td><td><strong>{formatCurrency(entry.netPay, run.currency)}</strong></td><td>{run.status === "finalized" && <button className="download-button" disabled={downloading === `${run._id}-${entry.employee}`} onClick={() => download(run, entry)}><Download size={15} /> Payslip</button>}</td></tr>)}</tbody></table></div>
              {canFinalize && run.status === "draft" && <button className="primary finalize-button" disabled={working === run._id} onClick={() => finalize(run._id)}>{working === run._id ? "Locking…" : "Lock & finalize payroll"} <LockKeyhole size={16} /></button>}
            </details>
          ))}</div>}
    </section>
  );
}

function PasswordChange({ token, onComplete }) {
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError("");
    if (values.newPassword !== values.confirmPassword) return setError("The new passwords do not match.");
    setSubmitting(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword })
      }, token);
      onComplete();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section className="workspace-card narrow-card">
      <div className="section-kicker">SECURE YOUR ACCOUNT</div>
      <h1>Choose a new password</h1>
      <p className="section-description">Your account was created with a temporary password. Set a personal password to continue.</p>
      <form className="fields" onSubmit={submit}>
        <label>Temporary password<input type="password" autoComplete="current-password" value={values.currentPassword} onChange={(event) => setValues({ ...values, currentPassword: event.target.value })} required /></label>
        <label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={values.newPassword} onChange={(event) => setValues({ ...values, newPassword: event.target.value })} required /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={values.confirmPassword} onChange={(event) => setValues({ ...values, confirmPassword: event.target.value })} required /></label>
        {error && <p className="alert">{error}</p>}
        <button className="primary" disabled={submitting}>{submitting ? "Updating…" : "Update password"} <ArrowRight size={17} /></button>
      </form>
    </section>
  );
}

function EmployeeOnboarding({ token }) {
  const initial = { employeeCode: "", firstName: "", lastName: "", email: "", department: "", position: "", monthlySalary: "", hireDate: "", terminationDate: "" };
  const [values, setValues] = useState(initial);
  const [options, setOptions] = useState({ departments: [], designations: [] });
  const [credentials, setCredentials] = useState(null);
  const [error, setError] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api("/api/settings", {}, token)
      .then(({ settings }) => setOptions({
        departments: settings?.departments || [],
        designations: settings?.designations || []
      }))
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoadingOptions(false));
  }, [token]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setCredentials(null);
    setSubmitting(true);
    try {
      const result = await api("/api/employees", {
        method: "POST",
        body: JSON.stringify(values)
      }, token);
      setCredentials(result.account);
      setValues(initial);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="workspace-card">
      <div className="section-kicker">PEOPLE · ONBOARDING</div>
      <h1>Add an employee</h1>
      <p className="section-description">Create an employee record and a login. The employee will be asked to replace their temporary password on first sign-in.</p>
      {credentials && <TemporaryCredentials account={credentials} />}
      <form className="fields workspace-form" onSubmit={submit}>
        <div className="workspace-grid">
          <label>Employee ID<input value={values.employeeCode} onChange={(event) => setValues({ ...values, employeeCode: event.target.value })} placeholder="e.g. EMP-1042" required maxLength={40} /></label>
          <label>Hire date<input type="date" value={values.hireDate} onChange={(event) => setValues({ ...values, hireDate: event.target.value })} /></label>
          <label>First name<input value={values.firstName} onChange={(event) => setValues({ ...values, firstName: event.target.value })} required maxLength={80} /></label>
          <label>Last name<input value={values.lastName} onChange={(event) => setValues({ ...values, lastName: event.target.value })} required maxLength={80} /></label>
          <label className="span-two">Work email<input type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} required maxLength={254} /></label>
          <label>Monthly gross salary<input type="number" min="0.01" step="0.01" value={values.monthlySalary} onChange={(event) => setValues({ ...values, monthlySalary: event.target.value })} placeholder="e.g. 5000" required /></label>
          <label>Termination date (optional)<input type="date" min={values.hireDate || undefined} value={values.terminationDate} onChange={(event) => setValues({ ...values, terminationDate: event.target.value })} /></label>
          <label>Department
            {options.departments.length
              ? <select value={values.department} onChange={(event) => setValues({ ...values, department: event.target.value })} required><option value="">Select a department</option>{options.departments.map((name) => <option key={name}>{name}</option>)}</select>
              : <input value={values.department} onChange={(event) => setValues({ ...values, department: event.target.value })} placeholder={loadingOptions ? "Loading…" : "Add a department in Office settings"} required maxLength={100} />}
          </label>
          <label>Designation
            {options.designations.length
              ? <select value={values.position} onChange={(event) => setValues({ ...values, position: event.target.value })} required><option value="">Select a designation</option>{options.designations.map((name) => <option key={name}>{name}</option>)}</select>
              : <input value={values.position} onChange={(event) => setValues({ ...values, position: event.target.value })} placeholder={loadingOptions ? "Loading…" : "Add a designation in Office settings"} required maxLength={100} />}
          </label>
        </div>
        {error && <p className="alert">{error}</p>}
        <button className="primary" disabled={submitting}>{submitting ? "Creating account…" : "Create employee login"} <ArrowRight size={17} /></button>
      </form>
    </section>
  );
}

function TemporaryCredentials({ account }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(`Email: ${account.email}\nTemporary password: ${account.tempPassword}`);
    setCopied(true);
  }
  return (
    <div className="credential-card">
      <strong>Login created — share these credentials securely</strong>
      <span>Email <b>{account.email}</b></span>
      <span>Temporary password <code>{account.tempPassword}</code></span>
      <span className="credential-note">This password is shown only now. The employee must change it at first sign-in.</span>
      <button type="button" className="copy-button" onClick={copy}><Clipboard size={15} /> {copied ? "Copied" : "Copy credentials"}</button>
    </div>
  );
}

function EmployeeCsvImport({ token }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);

  async function selectFile(event) {
    const file = event.target.files?.[0];
    setPreview(null);
    setResult(null);
    setError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) return setError("Choose a .csv file.");
    if (file.size > 1024 * 1024) return setError("CSV files must be 1 MB or smaller.");
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function validate() {
    setChecking(true);
    setError("");
    setResult(null);
    try {
      const data = await apiCsv("/api/employees/import/validate", csv, token);
      setPreview(data);
    } catch (requestError) {
      if (requestError.data?.rows) setPreview(requestError.data);
      setError(requestError.message);
    } finally {
      setChecking(false);
    }
  }

  async function importRows() {
    setImporting(true);
    setError("");
    try {
      setResult(await apiCsv("/api/employees/import", csv, token));
      setPreview(null);
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.data?.rows) setPreview({ ...requestError.data, invalidCount: requestError.data.rows.length });
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="workspace-card">
      <div className="section-kicker">PEOPLE · BULK IMPORT</div>
      <h1>Import employees from CSV</h1>
      <p className="section-description">Validate every row before importing. Each employee receives a unique temporary login password.</p>
      <div className="csv-instructions">
        <strong>Required columns (terminationDate is optional)</strong>
        <code>employeeCode, firstName, lastName, email, department, position, monthlySalary, hireDate, terminationDate</code>
        <span>monthlySalary is the monthly gross amount. Use YYYY-MM-DD for hireDate and optional terminationDate; leave unknown dates blank. Maximum 1,000 employees per file.</span>
      </div>
      <label className="file-picker">Choose CSV file<input type="file" accept=".csv,text/csv" onChange={selectFile} /></label>
      {fileName && <p className="file-name">{fileName}</p>}
      {error && <p className="alert csv-alert">{error}</p>}
      <div className="csv-actions">
        <button type="button" className="secondary" onClick={validate} disabled={!csv || checking || importing}>{checking ? "Validating…" : "Validate file"}</button>
        {preview && preview.invalidCount === 0 && preview.validCount > 0 && <button type="button" className="primary" onClick={importRows} disabled={importing}>{importing ? "Importing…" : `Import ${preview.validCount} employees`}</button>}
      </div>
      {preview && (
        <div className="csv-preview">
          <strong>{preview.validCount || 0} valid · {preview.invalidCount || 0} need attention</strong>
          {preview.errors?.map((message) => <p className="row-error" key={message}>{message}</p>)}
          {preview.rows?.filter((row) => row.errors?.length).map((row) => (
            <div className="row-error" key={row.row}>Row {row.row}: {row.errors.join(" ")}</div>
          ))}
        </div>
      )}
      {result && (
        <div className="csv-result">
          <strong>{result.created.length} employee login{result.created.length === 1 ? "" : "s"} created</strong>
          {result.created.map((account) => <div className="import-account" key={account.employeeId}>
            <b>Row {account.row} · {account.employeeCode} · {account.email}</b>
            <code>{account.tempPassword}</code>
          </div>)}
          {result.failures.map((failure) => <p className="row-error" key={failure.row}>Row {failure.row}: {failure.error}</p>)}
          {result.created.length > 0 && <p className="credential-note">Temporary passwords are shown once here. Share them securely; each employee must change theirs at first sign-in.</p>}
        </div>
      )}
    </section>
  );
}

function TaxSlabEditor({ slabs, onChange }) {
  function update(index, key, value) {
    onChange(slabs.map((slab, slabIndex) => slabIndex === index
      ? { ...slab, [key]: key === "upperLimit" ? value === "" ? null : Number(value) : Number(value) }
      : slab));
  }
  function addSlab() {
    const currentLast = slabs[slabs.length - 1];
    if (slabs.length >= 20) return;
    onChange([
      ...slabs.slice(0, -1),
      { ...currentLast, upperLimit: 100000 },
      { upperLimit: null, ratePercent: currentLast.ratePercent, baseTax: currentLast.baseTax }
    ]);
  }
  function removeSlab(index) {
    if (slabs.length <= 1) return;
    const next = slabs.filter((_slab, slabIndex) => slabIndex !== index);
    if (index === slabs.length - 1) next[next.length - 1].upperLimit = null;
    onChange([...next]);
  }
  return (
    <div className="tax-editor">
      <div className="tax-slab-heading"><span>Lower bound</span><span>Upper limit</span><span>Rate (%)</span><span>Base annual tax</span><span /></div>
      {slabs.map((slab, index) => {
        const lower = index === 0 ? 0 : slabs[index - 1].upperLimit;
        return <div className="tax-slab-row" key={index}>
          <span className="tax-band">{Number(lower || 0).toLocaleString()}</span>
          {slab.upperLimit === null
            ? <span className="open-ended">No upper limit</span>
            : <label><span className="mobile-tax-label">Upper limit</span><input type="number" min="1" value={slab.upperLimit ?? ""} onChange={(event) => update(index, "upperLimit", event.target.value)} required /></label>}
          <label><span className="mobile-tax-label">Rate (%)</span><input type="number" min="0" max="100" step="0.01" value={slab.ratePercent} onChange={(event) => update(index, "ratePercent", event.target.value)} required /></label>
          <label><span className="mobile-tax-label">Base annual tax</span><input type="number" min="0" step="0.01" value={slab.baseTax} onChange={(event) => update(index, "baseTax", event.target.value)} required /></label>
          {slabs.length > 1 && <button type="button" className="remove-holiday" onClick={() => removeSlab(index)}>Remove</button>}
        </div>;
      })}
      <button type="button" className="secondary add-holiday" onClick={addSlab} disabled={slabs.length >= 20}>Add tax slab</button>
      <p className="tax-setup-note">Tax is calculated progressively on annualized taxable income: base tax + income above the bracket's lower limit × its rate. Monthly withholding is annual tax ÷ 12.</p>
    </div>
  );
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const listFromText = (value) => [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];

function OfficeSettings({ token }) {
  const [settings, setSettings] = useState(null);
  const [lists, setLists] = useState({ departments: "", designations: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/api/settings", {}, token)
      .then(({ settings: current }) => {
        if (!current) throw new Error("Workspace settings are unavailable.");
        setSettings(current);
        setLists({
          departments: (current.departments || []).join("\n"),
          designations: (current.designations || []).join("\n")
        });
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [token]);

  function updateRule(name, value) {
    setSettings({ ...settings, officeRules: { ...settings.officeRules, [name]: value } });
  }
  function updateQuota(name, value) {
    setSettings({ ...settings, leaveQuotas: { ...settings.leaveQuotas, [name]: value } });
  }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    const payload = {
      ...settings,
      departments: listFromText(lists.departments),
      designations: listFromText(lists.designations),
      holidays: settings.holidays || [],
      leaveQuotas: Object.fromEntries(Object.entries(settings.leaveQuotas).map(([name, value]) => [name, Number(value)])),
      taxSlabs: settings.taxSlabs,
      officeRules: {
        ...settings.officeRules,
        graceMinutes: Number(settings.officeRules.graceMinutes)
      }
    };
    try {
      const data = await api("/api/settings", { method: "PATCH", body: JSON.stringify(payload) }, token);
      setSettings(data.settings);
      setLists({
        departments: data.settings.departments.join("\n"),
        designations: data.settings.designations.join("\n")
      });
      setMessage("Workspace rules saved.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="workspace-card">Loading office settings…</section>;
  if (!settings) return <section className="workspace-card"><p className="alert">{error}</p></section>;
  return (
    <section className="workspace-card">
      <div className="section-kicker">ADMIN · CONFIGURATION</div>
      <h1>Office settings</h1>
      <p className="section-description">Manage your work schedule, team structure, and annual leave allowances.</p>
      <form className="fields workspace-form" onSubmit={save}>
        <div className="settings-section">
          <h2>Office rules</h2>
          <div className="workspace-grid">
            <label>Organization name<input value={settings.organizationName} onChange={(event) => setSettings({ ...settings, organizationName: event.target.value })} required maxLength={120} /></label>
            <label>Timezone<input value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} required maxLength={64} /></label>
            <label>Currency<input value={settings.currency} onChange={(event) => setSettings({ ...settings, currency: event.target.value.toUpperCase() })} required minLength={3} maxLength={3} /></label>
            <label>Attendance mode<select value={settings.officeRules.attendanceMode} onChange={(event) => updateRule("attendanceMode", event.target.value)}><option value="office">Office-based</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select></label>
            <label>Workday starts<input type="time" value={settings.officeRules.workStart} onChange={(event) => updateRule("workStart", event.target.value)} required /></label>
            <label>Workday ends<input type="time" value={settings.officeRules.workEnd} onChange={(event) => updateRule("workEnd", event.target.value)} required /></label>
            <label>Late grace period (minutes)<input type="number" min="0" max="240" value={settings.officeRules.graceMinutes} onChange={(event) => updateRule("graceMinutes", event.target.value)} required /></label>
          </div>
          <fieldset className="weekday-picker"><legend>Working days</legend>{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={settings.officeRules.workDays.includes(index)} onChange={() => updateRule("workDays", settings.officeRules.workDays.includes(index) ? settings.officeRules.workDays.filter((value) => value !== index) : [...settings.officeRules.workDays, index].sort())} />{day}</label>)}</fieldset>
        </div>
        <div className="settings-section">
          <h2>Departments & designations</h2>
          <div className="workspace-grid">
            <label>Departments <span className="input-hint">One name per line</span><textarea rows="5" value={lists.departments} onChange={(event) => setLists({ ...lists, departments: event.target.value })} placeholder={"People\nEngineering\nFinance"} /></label>
            <label>Designations <span className="input-hint">One title per line</span><textarea rows="5" value={lists.designations} onChange={(event) => setLists({ ...lists, designations: event.target.value })} placeholder={"People Partner\nSoftware Engineer\nAnalyst"} /></label>
          </div>
        </div>
        <div className="settings-section">
          <h2>Annual leave quotas <span className="input-hint">Days per employee, per year</span></h2>
          <div className="workspace-grid quota-grid">{Object.entries(settings.leaveQuotas).map(([type, days]) => <label key={type}>{type[0].toUpperCase() + type.slice(1)} leave<input type="number" min="0" max="365" step="0.5" value={days} onChange={(event) => updateQuota(type, event.target.value)} required /></label>)}</div>
        </div>
        <div className="settings-section">
          <h2>Public holidays <span className="input-hint">These dates are excluded from leave-day calculations</span></h2>
          <div className="holiday-list">
            {(settings.holidays || []).map((holiday, index) => (
              <div className="holiday-row" key={`${holiday.date}-${index}`}>
                <label>Date<input type="date" value={holiday.date} onChange={(event) => setSettings({
                  ...settings,
                  holidays: settings.holidays.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item)
                })} required /></label>
                <label>Holiday name<input value={holiday.name} onChange={(event) => setSettings({
                  ...settings,
                  holidays: settings.holidays.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)
                })} maxLength={100} required /></label>
                <button type="button" className="remove-holiday" aria-label={`Remove ${holiday.name || "holiday"}`} onClick={() => setSettings({
                  ...settings,
                  holidays: settings.holidays.filter((_item, itemIndex) => itemIndex !== index)
                })}>Remove</button>
              </div>
            ))}
            <button type="button" className="secondary add-holiday" onClick={() => setSettings({
              ...settings,
              holidays: [...(settings.holidays || []), { date: "", name: "" }]
            })}>Add holiday</button>
          </div>
        </div>
        <div className="settings-section">
          <h2>Annual progressive tax slabs <span className="input-hint">Annual limits and base tax amounts in {settings.currency}</span></h2>
          <TaxSlabEditor slabs={settings.taxSlabs || defaultTaxSlabs} onChange={(taxSlabs) => setSettings({ ...settings, taxSlabs })} />
        </div>
        {error && <p className="alert">{error}</p>}
        {message && <p className="success-message">{message}</p>}
        <button className="primary save-settings" disabled={saving}>{saving ? "Saving…" : "Save office settings"} <Check size={17} /></button>
      </form>
    </section>
  );
}

export default App;
