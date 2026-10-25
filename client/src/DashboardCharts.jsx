import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

const chartColors = ["#39734a", "#d69c3c", "#6296aa", "#a16b91", "#8b9871"];

function EmptyChart({ message }) {
  return <div className="empty-chart">{message}</div>;
}

export default function DashboardCharts({ data }) {
  return (
    <div className="chart-grid">
      <article className="chart-card attendance-chart">
        <h2>Attendance trend</h2><p>Daily check-in status for {data?.month}</p>
        {data?.attendanceByDay?.length
          ? <ResponsiveContainer width="100%" height={260}><LineChart data={data.attendanceByDay}><CartesianGrid stroke="#edf0eb" vertical={false} /><XAxis dataKey="date" tickFormatter={(date) => date.slice(8)} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} /><Tooltip labelFormatter={(date) => `Date: ${date}`} /><Line type="monotone" dataKey="present" stroke="#39734a" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="late" stroke="#d69c3c" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="remote" stroke="#6296aa" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="absent" stroke="#a16b91" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
          : <EmptyChart message="No attendance records for this month yet." />}
        <div className="chart-legend">{[["Present", "#39734a"], ["Late", "#d69c3c"], ["Remote", "#6296aa"], ["Absent", "#a16b91"]].map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</div>
      </article>
      <article className="chart-card">
        <h2>Leave requests</h2><p>Requests overlapping {data?.month}</p>
        {data?.leaveByStatus?.some((item) => item.count > 0)
          ? <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={data.leaveByStatus} dataKey="count" nameKey="status" innerRadius={62} outerRadius={92} paddingAngle={3}>{data.leaveByStatus.map((item, index) => <Cell key={item.status} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
          : <EmptyChart message="No leave requests for this month yet." />}
        <div className="chart-legend">{(data?.leaveByStatus || []).map((item, index) => <span key={item.status}><i style={{ background: chartColors[index % chartColors.length] }} />{item.status} · {item.count}</span>)}</div>
      </article>
      <article className="chart-card department-chart">
        <h2>Employees by department</h2><p>Active headcount within your access scope</p>
        {data?.departments?.length
          ? <ResponsiveContainer width="100%" height={260}><BarChart data={data.departments} margin={{ left: 0, right: 12 }}><CartesianGrid stroke="#edf0eb" vertical={false} /><XAxis dataKey="department" tickLine={false} axisLine={false} interval={0} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} /><Tooltip /><Bar dataKey="count" name="Employees" fill="#39734a" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>
          : <EmptyChart message="No active employee data available." />}
      </article>
    </div>
  );
}
