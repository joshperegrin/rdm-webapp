import { useAtom } from "jotai";
import { reportsLoadable, recentSessionsLoadable, selectedSessionID } from "@/state";
import { BarChart2, Download, FileText, FileJson } from "lucide-react";
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

// ── Download Helpers ────────────────────────────────────────────────

function defectsToCSV(defects: any[], sessionLabel: string): string {
  const headers = [
    "ID",
    "Session ID",
    "Latitude",
    "Longitude",
    "Classification",
    "Status",
    "Archived",
  ];

  const rows = defects.map((d: any) => [
    d.road_defects_id ?? d.id ?? "",
    d.session ?? "",
    d.ave_lat ?? "",
    d.ave_lng ?? "",
    d.ave_classification ?? "Unknown",
    d.is_fixed === 1 ? "Fixed" : "Unfixed",
    d.is_archived === 1 ? "Yes" : "No",
  ]);

  const csvContent = [headers, ...rows]
    .map((row) =>
      row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  return csvContent;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(label: string): string {
  return label.replace(/[^a-z0-9_\-]/gi, "_").toLowerCase();
}

// ── Component ───────────────────────────────────────────────────────

function ReportsPage() {
  const [reportsValue] = useAtom(reportsLoadable);
  const [sessionsValue] = useAtom(recentSessionsLoadable);
  const [selectedSession, setSelectedSession] = useAtom(selectedSessionID);

  const sessions = sessionsValue.state === "hasData" ? sessionsValue.data : [];

  if (reportsValue.state === "loading") {
    return (
      <div className="flex items-center justify-center h-full w-full text-slate-400 bg-slate-50 dark:bg-slate-900">
        <p className="text-sm">Loading reports data...</p>
      </div>
    );
  }
  if (reportsValue.state === "hasError") {
    return (
      <div className="flex items-center justify-center h-full w-full text-red-400 bg-slate-50 dark:bg-slate-900">
        <p className="text-sm">Error loading data.</p>
      </div>
    );
  }

  const { sessions: reportSessions, allDefects: allRoadDefects } = reportsValue.data;

  // Filter defects by selected session if one is chosen
  const isAllSessions = !selectedSession || selectedSession === "";
  const roadDefects = isAllSessions
    ? allRoadDefects
    : allRoadDefects.filter(
        (d: any) =>
          d.session === Number(String(selectedSession).replace("session-", ""))
      );

  // KPI
  const totalSessions = reportSessions.length;
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

  // ── Download handlers ──
  const sessionLabel = isAllSessions
    ? "all_sessions"
    : sanitizeFilename(String(selectedSession));

  const handleDownloadCSV = () => {
    const csv = defectsToCSV(roadDefects, sessionLabel);
    downloadFile(csv, `road_defects_${sessionLabel}.csv`, "text/csv;charset=utf-8;");
  };

  const handleDownloadJSON = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      session: isAllSessions ? "all" : selectedSession,
      totalDefects: roadDefects.length,
      defects: roadDefects.map((d: any) => ({
        id: d.road_defects_id ?? d.id,
        session: d.session,
        latitude: d.ave_lat,
        longitude: d.ave_lng,
        classification: d.ave_classification ?? "Unknown",
        status: d.is_fixed === 1 ? "Fixed" : "Unfixed",
        archived: d.is_archived === 1,
      })),
    };
    downloadFile(
      JSON.stringify(payload, null, 2),
      `road_defects_${sessionLabel}.json`,
      "application/json"
    );
  };

  return (
    <div className="flex flex-row h-full w-full bg-slate-50 dark:bg-slate-900 p-4 gap-4 overflow-hidden">

      {/* Left Panel: Session Selector */}
      <div className="flex flex-col w-full md:w-1/3 lg:w-1/4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">

        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <BarChart2 className="w-5 h-5 text-blue-500" />
            Reports
          </h2>
        </div>

        {/* Session count badge */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 text-xs font-medium text-slate-500 uppercase tracking-wider flex justify-between items-center">
          <span>Sessions</span>
          <span className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full">
            {sessions.length} Total
          </span>
        </div>

        {/* All Sessions option */}
        <div className="px-2 pt-2">
          <button
            onClick={() => setSelectedSession("")}
            className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
              isAllSessions
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300"
                : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
            }`}
          >
            <div className="font-semibold">All Sessions</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Aggregate view
            </div>
          </button>
        </div>

        {/* Scrollable Sessions List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2 mt-1">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
              <BarChart2 className="w-12 h-12 mb-2 opacity-20" />
              <p className="text-sm">No sessions available.</p>
            </div>
          ) : (
            sessions.map((s: any) => (
              <button
                key={s.id}
                onClick={() => setSelectedSession(s.id)}
                className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                  selectedSession === s.id
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700"
                }`}
              >
                <div className="font-semibold text-slate-700 dark:text-slate-200">
                  ID: {s.id}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {s.timestamp}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right Panel: Dashboard */}
      <div className="flex-1 overflow-y-auto space-y-4">

        {/* Header with Download Buttons */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
              Reports Dashboard
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {!isAllSessions
                ? `Session: ${selectedSession}`
                : "Showing all sessions"}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-2 py-1 rounded-full font-medium">
              {totalDefects} Defects
            </span>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Sessions" value={totalSessions} />
          <KpiCard title="Total Defects" value={totalDefects} />
          <KpiCard title="Active Defects" value={activeDefects} />
          <KpiCard title="Fix Rate" value={`${fixRate}%`} />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Bar Chart */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
            <div className="px-0 pb-3 border-b border-slate-200 dark:border-slate-700 mb-4">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Defects by Classification
              </h2>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={defectsByType}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" />
                  <XAxis dataKey="type" tick={{ fontSize: 12, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: "8px",
                      color: "#f1f5f9",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Pie Chart */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
            <div className="pb-3 border-b border-slate-200 dark:border-slate-700 mb-4">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Status Distribution
              </h2>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    label
                  >
                    <Cell fill="#8b5cf6" />
                    <Cell fill="#3b82f6" />
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: "8px",
                      color: "#f1f5f9",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px", color: "#64748b" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* Defects Table */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Defect Records
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {roadDefects.length} entries
            </span>
          </div>

          <div className="overflow-x-auto">
            {roadDefects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-center">
                <BarChart2 className="w-10 h-10 mb-2 opacity-20" />
                <p className="text-sm">No defects found for this selection.</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="px-4 py-3 text-left font-medium">ID</th>
                    <th className="px-4 py-3 text-left font-medium">Session</th>
                    <th className="px-4 py-3 text-left font-medium">Classification</th>
                    <th className="px-4 py-3 text-left font-medium">Coordinates</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Archived</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {roadDefects.map((d: any, idx: number) => (
                    <tr
                      key={idx}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">
                        {d.road_defects_id ?? d.id ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {d.session ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-xs">
                          {d.ave_classification ?? "Unknown"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-mono">
                        {Number(d.ave_lat).toFixed(5)}, {Number(d.ave_lng).toFixed(5)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            d.is_fixed === 1
                              ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                              : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                          }`}
                        >
                          {d.is_fixed === 1 ? "Fixed" : "Unfixed"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {d.is_archived === 1 ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{title}</p>
      <h3 className="text-3xl font-bold mt-2 text-slate-700 dark:text-slate-200">{value}</h3>
    </div>
  );
}

export default ReportsPage;