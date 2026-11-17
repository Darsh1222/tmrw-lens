"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MotionConfig, motion } from "motion/react";
import { ArrowRight, CalendarBlank, FileText, ShieldCheck, ArrowCounterClockwise } from "@phosphor-icons/react";
import { SimpleRecovery } from "../recover/SimpleRecovery";
import { Lens } from "../_lens/Lens";
import { LiveSchedule } from "./LiveSchedule";
import type { ScheduleSnapshot } from "@/lib/recovery/schedule";
import { buttonClass } from "../_lens/styles";

const subscribe = () => () => {};
type Tab = "week" | "sources";
export function HomeWorkspace() {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
      {ready ? (
        <Workspace />
      ) : (
        <div className="workspace-loading">
          <h1>Make room for what’s next.</h1>
          <p>Opening your week…</p>
        </div>
      )}
    </MotionConfig>
  );
}
function Workspace() {
  const [tab, setTab] = useState<Tab>(() =>
    new URLSearchParams(window.location.search).get("tab") === "sources" ||
    /sample-week|upload|prove/.test(window.location.hash)
      ? "sources"
      : "week",
  );
  const [readerOpened, setReaderOpened] = useState(tab === "sources");
  const [mode, setMode] = useState<"auto" | "example" | "personal">(() =>
    new URLSearchParams(window.location.search).get("intent") === "task" ? "personal" : "auto",
  );
  const [mobileView, setMobileView] = useState<"action" | "schedule">("action");
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot | null>(null);
  const updateSchedule = useCallback((next: ScheduleSnapshot | null) => setSnapshot(next), []);
  const navigate = useCallback((next: Tab, clearEntry = false) => {
    setTab(next);
    if (next === "sources") setReaderOpened(true);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    if (clearEntry) for (const key of ["example", "view", "intent"]) url.searchParams.delete(key);
    url.hash = "";
    window.history.replaceState(null, "", url);
  }, []);
  useEffect(() => {
    const entry = new URL(window.location.href);
    if (entry.searchParams.get("intent") === "task") {
      for (const key of ["example", "view", "intent"]) entry.searchParams.delete(key);
      window.history.replaceState(null, "", entry);
    }
    const tabEvent = (event: Event) => navigate((event as CustomEvent<Tab>).detail);
    const personal = () => {
      navigate("week", true);
      setMobileView("action");
      setMode("personal");
      setRevision((n) => n + 1);
    };
    const imported = () => {
      navigate("week", true);
      setMobileView("action");
      setMode("auto");
      setRevision((n) => n + 1);
      document.getElementById("workspace")?.scrollIntoView({ block: "start" });
    };
    const hash = () => {
      if (window.location.hash === "#workspace") setTab("week");
      if (/sample-week|upload|prove/.test(window.location.hash)) {
        setReaderOpened(true);
        setTab("sources");
      }
    };
    window.addEventListener("lens:navigate", tabEvent);
    window.addEventListener("lens:plan-task", personal);
    window.addEventListener("lens:import-ready", imported);
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("lens:navigate", tabEvent);
      window.removeEventListener("lens:plan-task", personal);
      window.removeEventListener("lens:import-ready", imported);
      window.removeEventListener("hashchange", hash);
    };
  }, [navigate]);
  const focusView = (view: "action" | "schedule") => {
    setMobileView(view);
    requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>(view === "action" ? "#next-action h2" : "#calendar h2");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: "start" });
      }
    });
  };
  const choose = (next: "example" | "personal") => {
    navigate("week", next === "personal");
    setMobileView("action");
    setMode(next);
    setRevision((n) => n + 1);
  };
  return (
    <div className={`lens-workspace mobile-view-${mobileView}`}>
      <header className="workspace-intro">
        <h1>Make room for what’s next.</h1>
        <p>Check deadlines, plan study time, and recover when plans change.</p>
      </header>
      <div
        className="workspace-tabs"
        role="tablist"
        aria-label="Lens workspace"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === "Home" ? "week" : event.key === "End" ? "sources" : tab === "week" ? "sources" : "week";
          navigate(next);
          document.getElementById(next === "week" ? "week-tab" : "sources-tab")?.focus();
        }}
      >
        <button
          id="week-tab"
          tabIndex={tab === "week" ? 0 : -1}
          role="tab"
          aria-selected={tab === "week"}
          aria-controls="week-panel"
          onClick={() => navigate("week")}
        >
          <CalendarBlank size={18} />
          Your week{tab === "week" && <motion.span layoutId="workspace-tab" className="workspace-tab-indicator" />}
        </button>
        <button
          id="sources-tab"
          tabIndex={tab === "sources" ? 0 : -1}
          role="tab"
          aria-selected={tab === "sources"}
          aria-controls="sources-panel"
          onClick={() => navigate("sources")}
        >
          <FileText size={18} />
          Course material
          {tab === "sources" && <motion.span layoutId="workspace-tab" className="workspace-tab-indicator" />}
        </button>
        <span className="workspace-tabs-note">
          <ShieldCheck size={15} />
          You approve every change
        </span>
      </div>
      <section id="week-panel" role="tabpanel" aria-labelledby="week-tab" hidden={tab !== "week"}>
        <div className="workspace-section-bar" id="workspace">
          <div>
            <span className={`workspace-dot ${snapshot?.example ? "" : "is-personal"}`} />
            <p>
              <strong>
                {snapshot?.example
                  ? "Try it with an example"
                  : snapshot
                    ? "Your working plan"
                    : "Let’s start with one task"}
              </strong>
              <span>
                {snapshot?.example
                  ? "Sample dates · your own tasks stay saved"
                  : "Checked against the time and commitments you provide"}
              </span>
            </p>
          </div>
          <div className="workspace-mode-actions">
            <button onClick={() => choose("example")} className={buttonClass("plain", "workspace-reset")}>
              <ArrowCounterClockwise size={16} />
              {snapshot?.example ? "Reset" : "Try example"}
            </button>
            <button onClick={() => choose("personal")} className={buttonClass("quiet")}>
              {snapshot?.example ? "Use my own task" : "New task"}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
        <div className="mobile-workspace-switch" role="group" aria-label="Workspace view">
          <button
            aria-pressed={mobileView === "action"}
            aria-controls="next-action"
            onClick={() => setMobileView("action")}
          >
            {snapshot?.phase === "preview" ? "Review plan" : "Next step"}
          </button>
          <button
            aria-pressed={mobileView === "schedule"}
            aria-controls="calendar"
            onClick={() => setMobileView("schedule")}
          >
            <CalendarBlank size={16} />
            Schedule{snapshot?.phase === "preview" && <span>Preview</span>}
          </button>
        </div>
        <div className="workspace-grid">
          <div className="workspace-action" id="next-action">
            <SimpleRecovery key={revision} mode={mode} startWithExample onSchedule={updateSchedule} embedded />
            <button className="mobile-calendar-link" onClick={() => focusView("schedule")}>
              See the schedule
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="workspace-calendar" id="calendar">
            <LiveSchedule snapshot={snapshot} />
            <button className="mobile-calendar-link" onClick={() => focusView("action")}>
              {snapshot?.phase === "preview" ? "Back to review and approve" : "Back to your next step"}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </section>
      <section
        id="sources-panel"
        role="tabpanel"
        aria-labelledby="sources-tab"
        hidden={tab !== "sources"}
        className="workspace-sources"
      >
        {readerOpened && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Lens />
          </motion.div>
        )}
      </section>
      <section className="workspace-how" id="how" aria-labelledby="how-title">
        <h2 id="how-title">How Lens helps</h2>
        <p>
          <strong>Check the source.</strong> Review deadlines from your course material. <strong>Make room.</strong>{" "}
          Plan around your commitments. <strong>Keep going.</strong> Adjust unfinished work when life changes.
        </p>
      </section>
    </div>
  );
}
