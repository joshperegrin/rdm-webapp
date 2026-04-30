import { useAtom } from "jotai";
import { reportsLoadable, recentSessionsLoadable, selectedSessionID } from "@/state";
import { BarChart2, Download, FileText, FileJson, AlertTriangle, CheckCircle, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
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

// ── Types ────────────────────────────────────────────────────────────

type ReportDefect = {
  id?: string | number;
  road_defects_id?: string | number;
  session?: string | number;
  ave_lat?: number | string | null;
  ave_lng?: number | string | null;
  ave_classification?: string | null;
  is_fixed?: number | boolean | null;
  is_archived?: number | boolean | null;
};

type ReportSession = {
  id: string;
  timestamp: string;
};

type DefectTypeSummary = {
  type: string;
  count: number;
};

// ── DPWH DO 47 s.2024 — Defect Code Mapping ─────────────────────────
// Maps classification names (from your system) to DPWH defect codes.
// Adjust the keys to match your actual ave_classification values.
const DPWH_CODE_MAP: Record<string, string> = {
  Pothole: "01",
  "Patchy Road": "01",
  "Alligator Crack": "02",
  "Major Scaling": "03",
  "Shoving": "04",
  Corrugation: "04",
  "Pumping": "05",
  Depression: "05",
  "Faded Markings": "06",
  "No Markings": "06",
  "Shoulder Defect": "07",
  "Lush Vegetation": "08",
  "Clogged Drain": "09",
  "Open Manhole": "10",
  "No Sealant": "11",
  Crack: "12",
  Raveling: "13",
  "Unmaintained Signage": "14",
  "Unmaintained Bridge": "15",
  "Unmaintained Guardrail": "16",
};

// DPWH Table 6.1b — thresholds for score 1 (worst) per km.
// Unit: sqm/km for area defects, lm/km for linear, no/km for count.
// A density above this threshold means the section scores 1 (Poor).
// We use the score-2-to-1 boundary as the "needs fixing" trigger.
type DefectThreshold = {
  code: string;
  label: string;
  unit: string;
  // Score boundaries from Table 6.1b [5,4,3,2,1]
  // We flag as "Needs Fixing" when density exceeds the score-3 upper bound
  score3Max: number; // above this → score ≤ 2 → Needs Fixing
  weight: number;    // weight % from Table 6.1a
  responseTime: number; // working days
};

const DPWH_THRESHOLDS: DefectThreshold[] = [
  { code: "01", label: "Potholes",                   unit: "sqm/km", score3Max: 0.0214,   weight: 10, responseTime: 3  },
  { code: "02", label: "Alligator Cracks",            unit: "sqm/km", score3Max: 0.0596,   weight: 8,  responseTime: 3  },
  { code: "03", label: "Major Scaling",               unit: "sqm/km", score3Max: 0.1945,   weight: 9,  responseTime: 30 },
  { code: "04", label: "Shoving & Corrugation",       unit: "sqm/km", score3Max: 0.0328,   weight: 8,  responseTime: 10 },
  { code: "05", label: "Pumping & Depression",        unit: "sqm/km", score3Max: 1.5913,   weight: 9,  responseTime: 30 },
  { code: "06", label: "No/Faded Road Markings",      unit: "lm/km",  score3Max: 92.8394,  weight: 7,  responseTime: 15 },
  { code: "07", label: "Defects on Shoulders",        unit: "lm/km",  score3Max: 32.4848,  weight: 5,  responseTime: 7  },
  { code: "08", label: "Lush Vegetation",             unit: "lm/km",  score3Max: 34.9856,  weight: 3,  responseTime: 3  },
  { code: "09", label: "Clogged Drains",              unit: "lm/km",  score3Max: 9.1076,   weight: 5,  responseTime: 3  },
  { code: "10", label: "Open Manhole",                unit: "no/km",  score3Max: 0.0341,   weight: 5,  responseTime: 10 },
  { code: "11", label: "No/Inadequate Sealant",       unit: "lm/km",  score3Max: 62.3287,  weight: 3,  responseTime: 3  },
  { code: "12", label: "Cracks",                      unit: "lm/km",  score3Max: 5.1549,   weight: 5,  responseTime: 3  },
  { code: "13", label: "Raveling",                    unit: "sqm/km", score3Max: 3.6650,   weight: 5,  responseTime: 7  },
  { code: "14", label: "Unmaintained Signages",       unit: "no",     score3Max: 53,       weight: 5,  responseTime: 15 },
  { code: "15", label: "Unmaintained Bridges",        unit: "no",     score3Max: 10,       weight: 10, responseTime: 15 },
  { code: "16", label: "Unmaintained Guardrails",     unit: "no/km",  score3Max: 3.3228,   weight: 3,  responseTime: 15 },
];

// ── Percentage-Based Defect Types (no DPWH DO 47 threshold) ─────────
// These subtypes are not individually rated in DPWH Table 6.1b.
// They fall under broader DPWH codes (e.g. Code 01, 12) but lack their own
// per-km density thresholds. We compute them as:
//   affectedDistanceKm / totalSessionKm × 100
// and flag as "Needs Attention" when the affected stretch exceeds 10%
// of the total session length (practical engineering convention).

type PercentageDefectType = {
  classification: string; // must match ave_classification exactly
  label: string;
  parentCode: string;     // DPWH parent code for reference
  thresholdPct: number;   // flag above this percentage
};

const PERCENTAGE_DEFECT_TYPES: PercentageDefectType[] = [
  { classification: "Longitudinal Crack", label: "Longitudinal Crack", parentCode: "12", thresholdPct: 50 },
  { classification: "Transverse Crack",   label: "Transverse Crack",   parentCode: "12", thresholdPct: 50 },
  { classification: "Patchy Road",        label: "Patchy Road",        parentCode: "01", thresholdPct: 50 },
  { classification: "Edge Crack",         label: "Edge Crack",         parentCode: "12", thresholdPct: 50 },
  { classification: "Block Crack",        label: "Block Crack",        parentCode: "12", thresholdPct: 50 },
  { classification: "Rutting",            label: "Rutting",            parentCode: "04", thresholdPct: 50 },
];

type PercentageAssessment = {
  classification: string;
  label: string;
  parentCode: string;
  count: number;
  affectedKm: number;
  totalKm: number;
  percentage: number;
  thresholdPct: number;
  needsAttention: boolean;
};

// ── Haversine Distance (meters) ──────────────────────────────────────
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Compute total path length (meters) from ordered GPS points
function computePathLengthKm(defects: ReportDefect[]): number {
  const pts = defects
    .filter((d) => d.ave_lat != null && d.ave_lng != null)
    .map((d) => ({ lat: Number(d.ave_lat), lng: Number(d.ave_lng) }));

  if (pts.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += haversineMeters(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  }
  return total / 1000;
}

// Compute affected distance for a subset of defects (ordered GPS points of same type)
// We sum haversine distance between consecutive defect points of the same classification.
// This gives an approximation of the "stretch" impacted by that defect type.
function computeAffectedKm(defects: ReportDefect[]): number {
  const pts = defects
    .filter((d) => d.ave_lat != null && d.ave_lng != null)
    .map((d) => ({ lat: Number(d.ave_lat), lng: Number(d.ave_lng) }));
  if (pts.length === 0) return 0;
  if (pts.length === 1) return 0.01; // single point — minimal contribution
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += haversineMeters(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  }
  return total / 1000;
}

function computePercentageAssessment(
  defects: ReportDefect[],
  totalKm: number
): PercentageAssessment[] {
  return PERCENTAGE_DEFECT_TYPES.map((pdt) => {
    const subset = defects.filter(
      (d) => (d.ave_classification ?? "") === pdt.classification
    );
    const count = subset.length;
    const affectedKm = computeAffectedKm(subset);
    const percentage = totalKm > 0 ? (affectedKm / totalKm) * 100 : 0;
    const needsAttention = count > 0 && (percentage > pdt.thresholdPct || totalKm === 0);
    return {
      classification: pdt.classification,
      label: pdt.label,
      parentCode: pdt.parentCode,
      count,
      affectedKm,
      totalKm,
      percentage,
      thresholdPct: pdt.thresholdPct,
      needsAttention,
    };
  }).filter((a) => a.count > 0);
}

// ── DPWH Assessment ──────────────────────────────────────────────────
type DefectAssessment = {
  code: string;
  label: string;
  unit: string;
  count: number;
  density: number;      // count (or area proxy) per km
  score3Max: number;
  needsFixing: boolean;
  weight: number;
  responseTime: number;
};

function computeDPWHAssessment(
  defects: ReportDefect[],
  totalKm: number
): DefectAssessment[] {
  // Group defects by DPWH code
  const byCode: Record<string, number> = {};
  for (const d of defects) {
    const cls = d.ave_classification ?? "Unknown";
    const code = DPWH_CODE_MAP[cls] ?? null;
    if (code) {
      byCode[code] = (byCode[code] ?? 0) + 1;
    }
  }

  return DPWH_THRESHOLDS.map((thresh) => {
    const count = byCode[thresh.code] ?? 0;
    // Density = defect count per km (approximation; for area types ideally sqm but
    // we use count as a proportional proxy since we don't have measured area)
    const density = totalKm > 0 ? count / totalKm : 0;
    const needsFixing = density > thresh.score3Max || (totalKm === 0 && count > 0);
    return {
      code: thresh.code,
      label: thresh.label,
      unit: thresh.unit,
      count,
      density,
      score3Max: thresh.score3Max,
      needsFixing,
      weight: thresh.weight,
      responseTime: thresh.responseTime,
    };
  }).filter((a) => a.count > 0); // only show defect types that were found
}

// ── Download Helpers ─────────────────────────────────────────────────

function defectsToCSV(defects: ReportDefect[]): string {
  const headers = ["ID", "Session ID", "Latitude", "Longitude", "Classification", "Status", "Archived"];
  const rows = defects.map((d) => [
    d.road_defects_id ?? d.id ?? "",
    d.session ?? "",
    d.ave_lat ?? "",
    d.ave_lng ?? "",
    d.ave_classification ?? "Unknown",
    d.is_fixed === 1 ? "Fixed" : "Unfixed",
    d.is_archived === 1 ? "Yes" : "No",
  ]);
  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function buildSummaryReport(params: {
  sessionLabel: string;
  totalSessions: number;
  totalDefects: number;
  activeDefects: number;
  fixedDefects: number;
  fixRate: number;
  defectsByType: DefectTypeSummary[];
  totalKm: number;
  assessment: DefectAssessment[];
  percentageAssessment: PercentageAssessment[];
}): string {
  const {
    sessionLabel, totalSessions, totalDefects, activeDefects,
    fixedDefects, fixRate, defectsByType, totalKm, assessment, percentageAssessment,
  } = params;

  const needsFixingList = assessment.filter((a) => a.needsFixing);
  const needsAttentionList = percentageAssessment.filter((a) => a.needsAttention);
  const lines = [
    "Road Defects Report (DPWH DO 47 s.2024)",
    `Generated: ${new Date().toLocaleString()}`,
    `Scope: ${sessionLabel}`,
    "",
    "Overview",
    `Total Sessions: ${totalSessions}`,
    `Total Defects: ${totalDefects}`,
    `Active Defects: ${activeDefects}`,
    `Fixed Defects: ${fixedDefects}`,
    `Fix Rate: ${fixRate}%`,
    `Estimated Session Length: ${totalKm.toFixed(3)} km`,
    "",
    "DPWH DO 47 Assessment — Defects Requiring Immediate Action",
    ...(needsFixingList.length === 0
      ? ["All detected defect types are within acceptable density thresholds."]
      : needsFixingList.map(
          (a) =>
            `[Code ${a.code}] ${a.label}: ${a.count} found, density ${a.density.toFixed(4)} ${a.unit} (threshold ${a.score3Max} ${a.unit}) — respond within ${a.responseTime} working day(s)`
        )),
    "",
    "Percentage-Based Assessment — Defect Subtypes Without DPWH Threshold",
    ...(percentageAssessment.length === 0
      ? ["No percentage-tracked defect subtypes found."]
      : percentageAssessment.map(
          (a) =>
            `[Parent Code ${a.parentCode}] ${a.label}: ${a.count} found, affected ${a.affectedKm.toFixed(3)} km of ${totalKm.toFixed(3)} km (${a.percentage.toFixed(1)}%) — ${a.needsAttention ? `NEEDS ATTENTION (>${a.thresholdPct}%)` : "Acceptable"}`
        )),
    ...(needsAttentionList.length === 0 ? [] : [
      "",
      `${needsAttentionList.length} subtype(s) exceed the ${needsAttentionList[0]?.thresholdPct ?? 10}% affected-distance threshold.`,
    ]),
    "",
    "Defects by Classification",
    ...(defectsByType.length === 0
      ? ["No defect records found."]
      : defectsByType.map((item) => `${item.type}: ${item.count}`)),
  ];
  return lines.join("\n");
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
  return label.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

// ── Component ────────────────────────────────────────────────────────

function ReportsPage() {
  const [reportsValue] = useAtom(reportsLoadable);
  const [sessionsValue] = useAtom(recentSessionsLoadable);
  const [selectedSession, setSelectedSession] = useAtom(selectedSessionID);

  const sessions: ReportSession[] =
    sessionsValue.state === "hasData" ? (sessionsValue.data as ReportSession[]) : [];

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

  const { sessions: reportSessions, allDefects: allRoadDefects } = reportsValue.data as {
    sessions: ReportSession[];
    allDefects: ReportDefect[];
  };

  const isAllSessions = !selectedSession || selectedSession === "";
  const roadDefects = isAllSessions
    ? allRoadDefects
    : allRoadDefects.filter(
        (d) => d.session === Number(String(selectedSession).replace("session-", ""))
      );

  // ── KPIs ──
  const totalSessions = reportSessions.length;
  const totalDefects = roadDefects.length;
  const activeDefects = roadDefects.filter((d) => d.is_fixed === 0).length;
  const fixedDefects = roadDefects.filter((d) => d.is_fixed === 1).length;
  const fixRate = totalDefects === 0 ? 0 : Math.round((fixedDefects / totalDefects) * 100);

  // ── Distance & DPWH Assessment ──
  const totalKm = computePathLengthKm(roadDefects);
  const assessment = computeDPWHAssessment(roadDefects, totalKm);
  const needsFixingCount = assessment.filter((a) => a.needsFixing).length;

  // ── Percentage-based assessment (no DPWH threshold — subtypes) ──
  const percentageAssessment = computePercentageAssessment(roadDefects, totalKm);
  const needsAttentionCount = percentageAssessment.filter((a) => a.needsAttention).length;

  const defectsByType = roadDefects.reduce((acc: DefectTypeSummary[], item) => {
    const cls = item.ave_classification || "Unknown";
    const index = acc.findIndex((x) => x.type === cls);
    if (index >= 0) acc[index].count += 1;
    else acc.push({ type: cls, count: 1 });
    return acc;
  }, []);

  const statusData = [
    { name: "Fixed", value: fixedDefects },
    { name: "Unfixed", value: activeDefects },
  ];

  // ── Download handlers ──
  const selectedSessionLabel = isAllSessions
    ? "All Sessions"
    : `Session ${String(selectedSession).replace("session-", "")}`;
  const sessionFilename = isAllSessions
    ? "all_sessions"
    : sanitizeFilename(String(selectedSession));
  const hasReportData = roadDefects.length > 0;

  const handleDownloadCSV = () => {
    downloadFile(defectsToCSV(roadDefects), `road_defects_${sessionFilename}.csv`, "text/csv;charset=utf-8;");
  };

  const handleDownloadJSON = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      scope: selectedSessionLabel,
      session: isAllSessions ? "all" : selectedSession,
      totalSessions,
      totalDefects: roadDefects.length,
      estimatedSessionLengthKm: totalKm,
      dpwhAssessment: assessment,
      defects: roadDefects.map((d) => ({
        id: d.road_defects_id ?? d.id,
        session: d.session,
        latitude: d.ave_lat,
        longitude: d.ave_lng,
        classification: d.ave_classification ?? "Unknown",
        status: d.is_fixed === 1 ? "Fixed" : "Unfixed",
        archived: d.is_archived === 1,
      })),
    };
    downloadFile(JSON.stringify(payload, null, 2), `road_defects_${sessionFilename}.json`, "application/json");
  };

  const handleDownloadSummary = () => {
    const summary = buildSummaryReport({
      sessionLabel: selectedSessionLabel,
      totalSessions,
      totalDefects,
      activeDefects,
      fixedDefects,
      fixRate,
      defectsByType,
      totalKm,
      assessment,
      percentageAssessment,
    });
    downloadFile(summary, `road_defects_report_${sessionFilename}.txt`, "text/plain;charset=utf-8;");
  };

  return (
    <div className="flex flex-row h-full w-full bg-slate-50 dark:bg-slate-900 p-4 gap-4 overflow-hidden">

      {/* Left Panel: Session Selector */}
      <div className="flex flex-col w-full md:w-1/3 lg:w-1/4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <BarChart2 className="w-5 h-5 text-blue-500" />
            Reports
          </h2>
        </div>

        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 text-xs font-medium text-slate-500 uppercase tracking-wider flex justify-between items-center">
          <span>Sessions</span>
          <span className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full">
            {sessions.length} Total
          </span>
        </div>

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
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Aggregate view</div>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 mt-1">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
              <BarChart2 className="w-12 h-12 mb-2 opacity-20" />
              <p className="text-sm">No sessions available.</p>
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSession(s.id)}
                className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                  selectedSession === s.id
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700"
                }`}
              >
                <div className="font-semibold text-slate-700 dark:text-slate-200">ID: {s.id}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.timestamp}</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right Panel: Dashboard */}
      <div className="flex-1 overflow-y-auto space-y-4">

        {/* Header */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Reports Dashboard</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {!isAllSessions ? `Session: ${selectedSession}` : "Showing all sessions"} · Based on DPWH DO 47 s.2024
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-2 py-1 rounded-full font-medium">
              {totalDefects} Defects
            </span>
            <Button variant="outline" size="sm" onClick={handleDownloadCSV} disabled={!hasReportData} className="border-slate-200 dark:border-slate-700">
              <FileText className="w-4 h-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadJSON} disabled={!hasReportData} className="border-slate-200 dark:border-slate-700">
              <FileJson className="w-4 h-4" /> JSON
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadSummary} disabled={!hasReportData} className="border-slate-200 dark:border-slate-700">
              <Download className="w-4 h-4" /> Summary
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard title="Total Sessions" value={totalSessions} />
          <KpiCard title="Total Defects" value={totalDefects} />
          <KpiCard title="Active Defects" value={activeDefects} />
          <KpiCard title="Fix Rate" value={`${fixRate}%`} />
          <KpiCard
            title="Session Length"
            value={totalKm > 0 ? `${totalKm.toFixed(2)} km` : "N/A"}
            subtitle="Haversine path estimate"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
            <div className="px-0 pb-3 border-b border-slate-200 dark:border-slate-700 mb-4">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Defects by Classification</h2>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={defectsByType}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" />
                  <XAxis dataKey="type" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9", fontSize: "12px" }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
            <div className="pb-3 border-b border-slate-200 dark:border-slate-700 mb-4">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Status Distribution</h2>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={90} label>
                    <Cell fill="#8b5cf6" />
                    <Cell fill="#3b82f6" />
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9", fontSize: "12px" }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px", color: "#64748b" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ── DPWH DO 47 Assessment Panel ── */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Ruler className="w-4 h-4 text-blue-500" />
                DPWH DO 47 s.2024 — Defect Density Assessment
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Density = defects found ÷ {totalKm > 0 ? `${totalKm.toFixed(3)} km` : "session length"} · Threshold from Table 6.1b (Score 3 boundary)
              </p>
            </div>
            {needsFixingCount > 0 ? (
              <span className="flex items-center gap-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs px-2 py-1 rounded-full font-medium">
                <AlertTriangle className="w-3 h-3" />
                {needsFixingCount} type{needsFixingCount > 1 ? "s" : ""} need fixing
              </span>
            ) : assessment.length > 0 ? (
              <span className="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs px-2 py-1 rounded-full font-medium">
                <CheckCircle className="w-3 h-3" />
                All within threshold
              </span>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            {assessment.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 text-center">
                <Ruler className="w-8 h-8 mb-2 opacity-20" />
                <p className="text-sm">No mapped defects found for DPWH assessment.</p>
                <p className="text-xs mt-1 text-slate-400 dark:text-slate-500">
                  Ensure your classifications match the DPWH code map in the source file.
                </p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="px-4 py-3 text-left font-medium">Code</th>
                    <th className="px-4 py-3 text-left font-medium">Defect Type</th>
                    <th className="px-4 py-3 text-right font-medium">Count</th>
                    <th className="px-4 py-3 text-right font-medium">Density</th>
                    <th className="px-4 py-3 text-right font-medium">Threshold</th>
                    <th className="px-4 py-3 text-right font-medium">Unit</th>
                    <th className="px-4 py-3 text-center font-medium">Response Time</th>
                    <th className="px-4 py-3 text-center font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {assessment.map((a) => (
                    <tr
                      key={a.code}
                      className={`transition-colors ${
                        a.needsFixing
                          ? "bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20"
                          : "hover:bg-slate-50 dark:hover:bg-slate-700/50"
                      }`}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-slate-600 dark:text-slate-300">
                        {a.code}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 font-medium">
                        {a.label}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                        {a.count}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${
                        a.needsFixing ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                      }`}>
                        {a.density.toFixed(4)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500 dark:text-slate-400">
                        {a.score3Max}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400 dark:text-slate-500">
                        {a.unit}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-500 dark:text-slate-400">
                        {a.responseTime} day{a.responseTime > 1 ? "s" : ""}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {a.needsFixing ? (
                          <span className="inline-flex items-center gap-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-2 py-0.5 rounded text-xs font-medium">
                            <AlertTriangle className="w-3 h-3" /> Needs Fixing
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded text-xs font-medium">
                            <CheckCircle className="w-3 h-3" /> Acceptable
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {totalKm === 0 && roadDefects.length > 0 && (
            <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border-t border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Session length could not be computed (fewer than 2 GPS points with valid coordinates). Density figures may be inaccurate.
            </div>
          )}
        </div>

        {/* ── Percentage-Based Assessment Panel ── */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Ruler className="w-4 h-4 text-amber-500" />
                Defect-Affected Distance Assessment
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Subtypes without a DPWH DO 47 threshold — flagged when affected stretch exceeds <strong>10%</strong> of total session length ({totalKm > 0 ? `${totalKm.toFixed(3)} km` : "N/A"})
              </p>
            </div>
            {needsAttentionCount > 0 ? (
              <span className="flex items-center gap-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs px-2 py-1 rounded-full font-medium">
                <AlertTriangle className="w-3 h-3" />
                {needsAttentionCount} subtype{needsAttentionCount > 1 ? "s" : ""} need attention
              </span>
            ) : percentageAssessment.length > 0 ? (
              <span className="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs px-2 py-1 rounded-full font-medium">
                <CheckCircle className="w-3 h-3" />
                All within threshold
              </span>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            {percentageAssessment.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 text-center">
                <Ruler className="w-8 h-8 mb-2 opacity-20" />
                <p className="text-sm">No percentage-tracked defect subtypes found.</p>
                <p className="text-xs mt-1 text-slate-400 dark:text-slate-500">
                  Ensure classifications like "Longitudinal Crack", "Transverse Crack", "Patching" exist in your data.
                </p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="px-4 py-3 text-left font-medium">Parent Code</th>
                    <th className="px-4 py-3 text-left font-medium">Defect Subtype</th>
                    <th className="px-4 py-3 text-right font-medium">Count</th>
                    <th className="px-4 py-3 text-right font-medium">Affected Distance</th>
                    <th className="px-4 py-3 text-right font-medium">Session Length</th>
                    <th className="px-4 py-3 text-right font-medium">% of Session</th>
                    <th className="px-4 py-3 text-center font-medium">Threshold</th>
                    <th className="px-4 py-3 text-center font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {percentageAssessment.map((a) => (
                    <tr
                      key={a.classification}
                      className={`transition-colors ${
                        a.needsAttention
                          ? "bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20"
                          : "hover:bg-slate-50 dark:hover:bg-slate-700/50"
                      }`}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-slate-500 dark:text-slate-400">
                        {a.parentCode}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 font-medium">
                        {a.label}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                        {a.count}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {a.affectedKm.toFixed(3)} km
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500 dark:text-slate-400">
                        {a.totalKm.toFixed(3)} km
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${
                        a.needsAttention
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}>
                        {a.percentage.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-center text-slate-500 dark:text-slate-400">
                        &gt;{a.thresholdPct}%
                      </td>
                      <td className="px-4 py-3 text-center">
                        {a.needsAttention ? (
                          <span className="inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded text-xs font-medium">
                            <AlertTriangle className="w-3 h-3" /> Needs Attention
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded text-xs font-medium">
                            <CheckCircle className="w-3 h-3" /> Acceptable
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/30 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
            <strong>Note:</strong> Affected distance is estimated using the Haversine formula between consecutive GPS detections of the same defect subtype. The 10% threshold is an engineering convention — DPWH DO 47 s.2024 does not prescribe specific limits for these subtypes individually.
          </div>
        </div>

        {/* Defects Table */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Defect Records</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">{roadDefects.length} entries</span>
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
                  {roadDefects.map((d, idx: number) => (
                    <tr
                      key={idx}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">
                        {d.road_defects_id ?? d.id ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{d.session ?? "—"}</td>
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

// ── KPI Card ─────────────────────────────────────────────────────────

type KpiCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
};

function KpiCard({ title, value, subtitle }: KpiCardProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{title}</p>
      <h3 className="text-2xl font-bold mt-2 text-slate-700 dark:text-slate-200">{value}</h3>
      {subtitle && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

export default ReportsPage;