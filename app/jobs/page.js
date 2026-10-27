"use client";
import ErrorNote from "@/components/ErrorNote";
import { useEffect, useState } from "react";
import { Flag, Plus } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import JobCard from "@/components/JobCard";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";

function PostJobForm({ onCreated, onCancel }) {
  const [title, setTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!title.trim() || !companyName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const job = await api.createJob({
        title: title.trim(), companyName: companyName.trim(),
        salaryMin: salaryMin ? Number(salaryMin) : undefined, salaryMax: salaryMax ? Number(salaryMax) : undefined,
        lastPersonQuitReason: reason.trim() || undefined, mode: "alias",
      });
      onCreated(job);
    } catch (e) {
      setError(e.status === 401 ? "Log in to post a job." : e.message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "8px 10px", fontSize: 13, width: "100%" };

  return (
    <div style={{ background: C.surface, border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 10 }} className="p-4 flex flex-col gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" maxLength={80} style={inputStyle} />
      <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" maxLength={80} style={inputStyle} />
      <div className="flex gap-2">
        <input value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} type="number" placeholder="Salary min $ (optional)" style={inputStyle} />
        <input value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} type="number" placeholder="Salary max $ (optional)" style={inputStyle} />
      </div>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>Leaving salary blank gets this posting buried below disclosed ones — that's the whole point of this board.</div>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why did the last person leave this role? (be honest — it raises your honesty score)" rows={2} maxLength={300} style={{ ...inputStyle, resize: "none" }} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!title.trim() || !companyName.trim() || busy} style={{ ...monoFont, fontSize: 12, color: "#FFFFFF", background: C.mustard, border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, cursor: "pointer" }}>{busy ? "posting…" : "Post job"}</button>
        <button onClick={onCancel} style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

// Jobs is paused (not deleted) — flip this back to true, alongside the
// matching flag in components/Shell.jsx and app/search/page.js, to bring
// the whole section back.
const JOBS_ENABLED = false;

function JobsPausedNotice() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ padding: "60px 20px" }}>
      <Flag size={22} style={{ color: C.muted }} />
      <div style={{ ...monoFont, fontSize: 13, color: C.text, fontWeight: 700 }}>Jobs is paused for now</div>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted, maxWidth: 360 }}>
        This section is temporarily switched off while we work on it. Nothing here was deleted — it'll be back.
      </div>
    </div>
  );
}

export default function JobsPage() {
  if (!JOBS_ENABLED) return <JobsPausedNotice />;
  return <JobsPageContent />;
}

function JobsPageContent() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    api.getJobs().then(setJobs).catch((e) => setError(e.message));
  }, []);

  function handleCreated(job) {
    setJobs((js) => [job, ...(js || [])]);
    setShowCreate(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: C.muted }}>
          <Flag size={13} color={C.flag} /> postings with no salary range get auto-flagged and buried
        </div>
        {user && !showCreate && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1" style={{ ...monoFont, fontSize: 12, color: C.mustard, border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 20, padding: "4px 10px", background: "none", cursor: "pointer" }}>
            <Plus size={12} /> Post a job
          </button>
        )}
      </div>
      {showCreate && <PostJobForm onCreated={handleCreated} onCancel={() => setShowCreate(false)} />}
      {error && <div style={{ ...monoFont, fontSize: 12, color: C.flag }}>couldn't load jobs: {error}</div>}
      {!jobs && !error && <Loading variant="list" />}
      {jobs && jobs.length === 0 && <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>No jobs posted yet.</div>}
      {jobs && jobs.map((j) => <JobCard key={j.id} job={j} />)}
    </div>
  );
}
