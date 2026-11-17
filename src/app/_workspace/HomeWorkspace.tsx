"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MotionConfig, motion } from "motion/react";
import { ArrowDown, ArrowUpRight, CalendarBlank, FileText, ShieldCheck, Sparkle } from "@phosphor-icons/react";
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
          <span className="workspace-eyebrow">Tomorrow Lens</span>
          <h1 className="forum-display">Make room for what’s next.</h1>
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
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot | null>(null);
  const updateSchedule = useCallback((next: ScheduleSnapshot | null) => setSnapshot(next), []);
  const navigate = useCallback((next: Tab) => {
    setTab(next);
    if (next === "sources") setReaderOpened(true);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    url.hash = "";
    window.history.replaceState(null, "", url);
  }, []);
  useEffect(() => {
    const tabEvent = (event: Event) => navigate((event as CustomEvent<Tab>).detail);
    const personal = () => {
      navigate("week");
      setMode("personal");
      setRevision((n) => n + 1);
    };
    const imported = () => {
      navigate("week");
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
  const choose = (next: "example" | "personal") => {
    navigate("week");
    setMode(next);
    setRevision((n) => n + 1);
  };
  return (
    <div className="lens-workspace">
      <header className="workspace-intro">
        <div>
          <p className="workspace-eyebrow">
            <Sparkle size={15} weight="light" />
            Less catching up. More moving forward.
          </p>
          <h1 className="forum-display">Make room for what’s next.</h1>
        </div>
        <p>Your deadlines, your time, and a plan that can change with you.</p>
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
            <span>
              {snapshot?.example ? "An example you can try" : snapshot ? "Your working plan" : "Start with one task"}
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => choose("example")} className={buttonClass("plain", "min-h-9 px-2 text-xs")}>
              Try an example
            </button>
            <button onClick={() => choose("personal")} className={buttonClass("quiet", "min-h-9 px-3 text-xs")}>
              Plan my task
              <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
        <div className="workspace-grid">
          <div className="workspace-action" id="next-action">
            <SimpleRecovery key={revision} mode={mode} startWithExample onSchedule={updateSchedule} embedded />
            <a className="mobile-calendar-link" href="#calendar">
              See the schedule
              <ArrowDown size={15} />
            </a>
          </div>
          <div className="workspace-calendar" id="calendar">
            <LiveSchedule snapshot={snapshot} />
            <a className="mobile-calendar-link" href="#next-action">
              Back to your next step ↑
            </a>
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
        <div>
          <p className="workspace-eyebrow">A plan you can trust</p>
          <h2 id="how-title" className="forum-display">
            Clear about the facts. Flexible about the plan.
          </h2>
        </div>
        <div className="workspace-principles">
          <p>
            <span>01</span>
            <strong>Check the source.</strong>Every extracted deadline stays connected to the words it came from.
          </p>
          <p>
            <span>02</span>
            <strong>Make room.</strong>Study time fits around the commitments and availability you provide.
          </p>
          <p>
            <span>03</span>
            <strong>Keep going.</strong>Finish a step or change the plan. Unfinished work stays accounted for.
          </p>
        </div>
      </section>
    </div>
  );
}
