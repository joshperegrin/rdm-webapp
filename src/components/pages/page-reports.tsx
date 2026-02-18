import { useAtom } from "jotai";
import { reportsLoadable } from "@/state";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

function ReportsPage() {
  const [reportsValue] = useAtom(reportsLoadable);
  if (reportsValue.state === "loading") {
    return (
      <div className="flex items-center justify-center h-full w-full text-white">
        Loading reports data...
      </div>
    );
  }
  if (reportsValue.state === "hasError") {
    return (
      <div className="flex items-center justify-center h-full w-full text-red-400">
        Error loading data.
      </div>
    );
  }
  const { sessions, allDefects: roadDefects } = reportsValue.data;

  // KPI
  const totalSessions = sessions.length;
  const totalDefects = roadDefects.length;
  const activeDefects = roadDefects.filter((d: any) => d.is_fixed === 0).length;
  const fixedDefects = roadDefects.filter((d: any) => d.is_fixed === 1).length;
  const fixRate =
    totalDefects === 0 ? 0 : Math.round((fixedDefects / totalDefects) * 100);

  const defectsByType = roadDefects.reduce(
    (acc: any[], item: any) => {
      const cls = item.ave_classification || "Unknown";
      const index = acc.findIndex((x) => x.type === cls);
      if (index >= 0) acc[index].count += 1;
      else acc.push({ type: cls, count: 1 });
      return acc;
    },
    []
  );

  const statusData = [
    { name: "Fixed", value: fixedDefects },
    { name: "Unfixed", value: activeDefects },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-slate-900 text-white p-6 overflow-y-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Reports Dashboard</h1>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard title="Total Sessions" value={totalSessions} />
        <KpiCard title="Total Defects" value={totalDefects} />
        <KpiCard title="Active Defects" value={activeDefects} />
        <KpiCard title="Fix Rate" value={`${fixRate}%`} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Bar Chart */}
        <div className="lg:col-span-2 bg-slate-800 p-4 rounded-lg shadow">
          <h2 className="text-sm font-medium mb-3">Defects by Classification</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={defectsByType}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="type" stroke="#cbd5e1" />
                <YAxis stroke="#cbd5e1" />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart */}
        <div className="bg-slate-800 p-4 rounded-lg shadow">
          <h2 className="text-sm font-medium mb-3">Status Distribution</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  type="monotone"
                  dataKey="value"
                  nameKey="name"
                  outerRadius={100}
                  label
                >
                  <Cell fill="#8b5cf6" />
                  <Cell fill="#3b82f6" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

type KpiCardProps = {
  title: string;
  value: string | number;
};

function KpiCard({ title, value }: KpiCardProps) {
  return (
    <div className="bg-slate-800 p-4 rounded-lg shadow hover:bg-slate-700 transition border border-slate-700">
      <p className="text-slate-400 text-xs uppercase tracking-wide">{title}</p>
      <h3 className="text-3xl font-bold mt-2 text-white">{value}</h3>
    </div>
  );
}

export default ReportsPage;