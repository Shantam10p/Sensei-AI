import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useLocation, useNavigate } from "react-router-dom";

import {
  completeStudyTask,
  deleteChatHistory,
  fetchChatHistory,
  fetchSenseiContent,
  saveChatMessage,
  sendSenseiMessage,
} from "../api";
import senseiLogo from "../assets/sensei_face.png";
import type { PlannerStudyTask } from "../types/planner";
import type {
  SenseiChatMessage,
  SenseiConceptItem,
  SenseiContentResponse,
  SenseiPracticeQuestion,
  SenseiSource,
} from "../types/sensei";

type StudyModeLocationState = {
  courseId: number;
  courseName: string;
  task: PlannerStudyTask;
  dayIndex: number;
  senseiContent?: SenseiContentResponse;
};

const SENSEI_TABS = ["Notes", "Practice", "Chat"] as const;
type SenseiTab = (typeof SENSEI_TABS)[number];

// Mobile: which panel is foregrounded
type MobilePanel = "timer" | "sensei";

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function deriveTopicFromTitle(title: string) {
  return title
    .replace(/^(Study|Continue|Revisit|Review)\s+/i, "")
    .replace(/\s+using\s+.+$/i, "")
    .trim();
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Renders the web-search sources Sensei used to ground an answer.
function SourcesList({ sources }: { sources: SenseiSource[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-3 border-t border-[#2a2a2a] pt-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[13px] text-[#8fa1a1]">travel_explore</span>
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8fa1a1]">Sources</span>
      </div>
      <ul className="space-y-1.5">
        {sources.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-[2px] shrink-0 text-[10px] font-mono tabular-nums text-[#767575]">
              {String(i + 1).padStart(2, "0")}
            </span>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group min-w-0 text-[11px] leading-relaxed text-[#acabaa] hover:text-[#cdc0ec] transition-colors"
            >
              <span className="underline decoration-[#3a3a3a] decoration-dotted underline-offset-2 group-hover:decoration-[#cdc0ec]">
                {s.title}
              </span>
              <span className="ml-1.5 text-[10px] text-[#767575]">{hostLabel(s.url)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StudyModePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as StudyModeLocationState | null;

  const session = state?.task;
  const timerStorageKey =
    state?.courseId && session?.id
      ? `study_timer:${state.courseId}:${state.dayIndex}:${session.id}`
      : null;
  const topic = useMemo(
    () => deriveTopicFromTitle(session?.title ?? "this topic"),
    [session?.title]
  );

  const userName = useMemo(() => {
    try {
      const u = JSON.parse(localStorage.getItem("auth_user") || "{}");
      return u.name?.split(" ")[0] || "there";
    } catch {
      return "there";
    }
  }, []);

  // ── state ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SenseiTab>("Notes");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("timer");
  const [isRunning, setIsRunning] = useState(true);
  const [timeLeft, setTimeLeft] = useState(session ? session.duration_minutes * 60 : 0);
  const [timerReady, setTimerReady] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  const [concepts, setConcepts] = useState<SenseiConceptItem[]>([]);
  const [practiceQuestions, setPracticeQuestions] = useState<SenseiPracticeQuestion[]>([]);
  const [contentSources, setContentSources] = useState<SenseiSource[]>([]);
  const [expandedAnswers, setExpandedAnswers] = useState<Set<number>>(new Set());
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<SenseiChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // ── redirect ─────────────────────────────────────────────
  useEffect(() => {
    if (!session) navigate("/dashboard", { replace: true });
  }, [navigate, session]);

  // ── timer load from storage ───────────────────────────────
  useEffect(() => {
    if (!session) {
      setTimeLeft(0);
      setIsRunning(true);
      setTimerReady(true);
      return;
    }
    const def = session.duration_minutes * 60;
    if (!timerStorageKey) {
      setTimeLeft(def);
      setIsRunning(true);
      setTimerReady(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(timerStorageKey);
      if (!raw) {
        setTimeLeft(def);
        setIsRunning(true);
      } else {
        const p = JSON.parse(raw) as { timeLeft?: number; isRunning?: boolean };
        setTimeLeft(typeof p.timeLeft === "number" ? p.timeLeft : def);
        setIsRunning(typeof p.isRunning === "boolean" ? p.isRunning : true);
      }
    } catch {
      setTimeLeft(def);
      setIsRunning(true);
    }
    setTimerReady(true);
  }, [session, timerStorageKey]);

  // ── timer persist ─────────────────────────────────────────
  useEffect(() => {
    if (!session || !timerStorageKey || !timerReady) return;
    window.localStorage.setItem(timerStorageKey, JSON.stringify({ timeLeft, isRunning }));
  }, [isRunning, session, timeLeft, timerReady, timerStorageKey]);

  // ── countdown ────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning || timeLeft <= 0) return;
    const id = window.setInterval(() => {
      setTimeLeft((c) => {
        if (c <= 1) { window.clearInterval(id); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRunning, timeLeft]);

  // ── sensei content load ───────────────────────────────────
  useEffect(() => {
    if (!session || !state) return;
    const welcome: SenseiChatMessage = {
      role: "assistant",
      content: `Hi ${userName}! I'm your Sensei. Ask me anything about ${topic} and I'll help you understand it.`,
    };
    let cancelled = false;
    setContentLoading(true);
    setContentError(null);

    const contentPromise = state.senseiContent
      ? Promise.resolve(state.senseiContent)
      : fetchSenseiContent({ topic, course_name: state.courseName, course_id: state.courseId });

    Promise.all([contentPromise, fetchChatHistory(session.id)])
      .then(([contentData, historyData]) => {
        if (cancelled) return;
        setConcepts(contentData.concepts);
        setPracticeQuestions(contentData.practice_questions);
        setContentSources(contentData.sources ?? []);
        if (historyData.messages.length > 0) {
          setChatHistory(
            historyData.messages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
              sources: m.sources ?? [],
            }))
          );
        } else {
          setChatHistory([welcome]);
          saveChatMessage({ task_id: session.id, role: "assistant", content: welcome.content });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setContentError("Sensei couldn't load content right now. Try refreshing.");
      })
      .finally(() => {
        if (cancelled) return;
        setContentLoading(false);
      });

    return () => { cancelled = true; };
  }, [session?.id]);

  // ── auto-scroll chat ──────────────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatSending]);

  // ── handlers ─────────────────────────────────────────────
  const handleCompleteSession = async () => {
    if (!session || isCompleting) return;
    setIsCompleting(true);
    setCompletionError(null);
    try {
      await completeStudyTask(session.id);
      if (timerStorageKey) window.localStorage.removeItem(timerStorageKey);
      navigate("/dashboard");
    } catch (err) {
      setCompletionError(err instanceof Error ? err.message : "Failed to complete session");
    } finally {
      setIsCompleting(false);
    }
  };

  const handleSendMessage = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatSending || !state || !session) return;
    const userMsg: SenseiChatMessage = { role: "user", content: trimmed };
    const updated = [...chatHistory, userMsg];
    setChatHistory(updated);
    setChatInput("");
    setChatSending(true);
    setChatError(null);
    saveChatMessage({ task_id: session.id, role: "user", content: trimmed });
    try {
      const res = await sendSenseiMessage({
        topic,
        course_name: state.courseName,
        history: chatHistory,
        message: trimmed,
      });
      const asstMsg: SenseiChatMessage = { role: "assistant", content: res.reply, sources: res.sources ?? [] };
      setChatHistory([...updated, asstMsg]);
      saveChatMessage({ task_id: session.id, role: "assistant", content: res.reply, sources: res.sources ?? [] });
    } catch {
      setChatError("Sensei couldn't respond. Please try again.");
      setChatHistory(chatHistory);
    } finally {
      setChatSending(false);
    }
  };

  const handleClearChat = async () => {
    if (!session) return;
    const welcome: SenseiChatMessage = {
      role: "assistant",
      content: `Hi ${userName}! I'm your Sensei. Ask me anything about ${topic} and I'll help you understand it.`,
    };
    await deleteChatHistory(session.id);
    setChatHistory([welcome]);
    saveChatMessage({ task_id: session.id, role: "assistant", content: welcome.content });
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!session || !state) return null;

  // ── timer progress ring (mobile) ─────────────────────────
  const totalSeconds = session.duration_minutes * 60;
  const progress = totalSeconds > 0 ? (totalSeconds - timeLeft) / totalSeconds : 0;
  const RING_R = 72;
  const RING_C = 2 * Math.PI * RING_R;

  // ── shared: Sensei tab content ────────────────────────────
  const senseiContent = (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-5">
      {/* skeleton */}
      {contentLoading && activeTab !== "Chat" && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-[#1b1c1c]" />
          ))}
        </div>
      )}

      {/* error */}
      {contentError && !contentLoading && (
        <div className="rounded-xl bg-[#1b1c1c] p-4 text-sm text-[#ec7c8a]">{contentError}</div>
      )}

      {/* Notes */}
      {activeTab === "Notes" && !contentLoading && !contentError && (
        <div className="space-y-4 md:space-y-5">
          {concepts.map((concept, i) => (
            <div
              key={i}
              className="rounded-xl border-l-2 md:border-l-[3px] border-l-[#cdc0ec]/50 md:border-l-[#cdc0ec]/35 bg-[#161616] border border-[#202020] px-4 py-4 md:px-5 md:py-6"
            >
              <div className="flex items-center gap-2.5 mb-3 md:mb-4">
                <span className="text-[10px] md:text-[11px] font-mono font-bold tabular-nums text-[#cdc0ec]/50 md:text-[#cdc0ec]/70">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h4 className="text-[13px] md:text-[14px] font-semibold text-[#e7e5e5] leading-snug">
                  {concept.title}
                </h4>
              </div>
              <p className="text-[12px] md:text-[13px] leading-relaxed text-[#acabaa] mb-3 md:mb-5">{concept.definition}</p>
              <div className="mb-3 md:mb-5">
                <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.18em] md:tracking-[0.15em] mb-2 md:mb-3 text-[#cdc0ec]">
                  Key Points
                </p>
                <ul className="space-y-1.5 md:space-y-2.5">
                  {concept.key_points.map((pt, j) => (
                    <li key={j} className="flex items-start gap-2 md:gap-2.5 text-[11px] md:text-[12px] text-[#e7e5e5] leading-relaxed">
                      <span className="mt-[3px] shrink-0 text-[#cdc0ec] font-bold md:text-[11px]">›</span>
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg bg-[#0f0f0f] px-3 py-2.5 md:px-4 md:py-3.5 text-[11px] md:text-[12px] leading-relaxed text-[#8fa1a1]">
                <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.12em] mr-1.5 md:mr-2 text-[#767575] md:text-[#8fa1a1]">
                  Example —
                </span>
                {concept.example}
              </div>
              {concept.code_example && (
                <div className="mt-3 md:mt-4">
                  <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.18em] md:tracking-[0.15em] mb-1.5 md:mb-2 text-[#7fd29a]">
                    Code Example
                  </p>
                  <pre className="overflow-x-auto rounded-lg bg-[#0a0a0a] border border-[#1e1e1e] px-3 py-2.5 md:px-4 md:py-3.5 text-[10px] md:text-[11px] text-[#7fd29a] font-mono leading-relaxed whitespace-pre">
                    {concept.code_example}
                  </pre>
                </div>
              )}
            </div>
          ))}
          {contentSources.length > 0 && (
            <div className="rounded-xl bg-[#161616] border border-[#202020] px-4 py-4 md:px-5 md:py-5">
              <SourcesList sources={contentSources} />
            </div>
          )}
        </div>
      )}

      {/* Practice */}
      {activeTab === "Practice" && !contentLoading && !contentError && (
        <div className="space-y-3 md:space-y-5">
          {practiceQuestions.map((pq, i) => (
            <div
              key={i}
              className="rounded-xl border-l-2 md:border-l-[3px] border-l-[#8fa1a1]/50 md:border-l-[#8fa1a1]/40 bg-[#161616] border border-[#202020] px-4 py-4 md:px-5 md:py-6"
            >
              <div className="flex items-start gap-2.5 mb-3 md:mb-5">
                <span className="text-[10px] md:text-[11px] font-mono font-bold tabular-nums text-[#8fa1a1]/50 md:text-[#8fa1a1]/70 mt-[2px] shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="text-[12px] md:text-[13px] font-semibold leading-relaxed text-[#e7e5e5]">{pq.question}</p>
              </div>
              <button
                onClick={() =>
                  setExpandedAnswers((prev) => {
                    const next = new Set(prev);
                    next.has(i) ? next.delete(i) : next.add(i);
                    return next;
                  })
                }
                className="flex items-center gap-1.5 mb-2.5 group"
              >
                <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.15em] text-[#8fa1a1] group-hover:text-[#a8bcbc] transition-colors">
                  {expandedAnswers.has(i) ? "Hide Answer" : "Click to Reveal"}
                </span>
                <span
                  className={`material-symbols-outlined text-[12px] md:text-[13px] text-[#8fa1a1] group-hover:text-[#a8bcbc] transition-transform duration-200 ${
                    expandedAnswers.has(i) ? "rotate-180" : ""
                  }`}
                >
                  expand_more
                </span>
              </button>
              {expandedAnswers.has(i) && (
                <div className="rounded-lg bg-[#0f0f0f] px-3 py-2.5 md:px-4 md:py-3.5 text-[11px] md:text-[12px] leading-relaxed text-[#acabaa]">
                  {pq.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Chat */}
      {activeTab === "Chat" && (
        <div className="flex flex-col gap-3">
          {chatHistory.map((msg, i) => (
            <div
              key={i}
              className={`max-w-[88%] rounded-2xl px-3.5 py-3 text-[13px] leading-relaxed ${
                msg.role === "assistant"
                  ? "rounded-tl-sm bg-[#4b4166]/30 text-[#dbcefb]"
                  : "ml-auto rounded-tr-sm bg-[#1e1e1e] text-[#e7e5e5]"
              }`}
            >
              {msg.role === "assistant" ? (
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    code: ({ children }) => (
                      <code className="bg-[#1b1c1c] text-[#cdc0ec] px-1 py-0.5 rounded text-xs font-mono">
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre className="bg-[#1b1c1c] text-[#e7e5e5] p-3 rounded-lg text-xs font-mono overflow-x-auto mb-2">
                        {children}
                      </pre>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-[#e7e5e5]">{children}</strong>
                    ),
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              ) : (
                msg.content
              )}
              {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                <SourcesList sources={msg.sources} />
              )}
            </div>
          ))}
          {chatSending && (
            <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-[#4b4166]/30 px-3.5 py-3 text-[13px] text-[#dbcefb]">
              <span className="animate-pulse">Sensei is thinking...</span>
            </div>
          )}
          {chatError && <p className="text-xs text-[#ec7c8a]">{chatError}</p>}
          <div ref={chatBottomRef} />
        </div>
      )}
    </div>
  );

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#0e0e0e] text-[#e7e5e5] flex flex-col">

      {/* ════════════════════════════════════════
          MOBILE LAYOUT  (hidden on md+)
      ════════════════════════════════════════ */}
      <div className="md:hidden flex flex-col h-full">

        {/* Top bar */}
        <header className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3 bg-[#0e0e0e]">
          <button
            onClick={() => navigate("/dashboard")}
            className="w-9 h-9 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center shrink-0 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[#acabaa] text-xl">arrow_back</span>
          </button>

          <div className="flex-1 min-w-0">
            <p className="text-[9px] uppercase tracking-widest text-[#8fa1a1] truncate">{state.courseName}</p>
            <p className="text-sm font-semibold text-[#e7e5e5] truncate leading-tight">{session.title}</p>
          </div>

          {/* Panel toggle pill */}
          <div className="shrink-0 flex items-center bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
            <button
              onClick={() => setMobilePanel("timer")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-all ${
                mobilePanel === "timer"
                  ? "bg-[#4b4166] text-[#cdc0ec]"
                  : "text-[#767575]"
              }`}
            >
              <span className="material-symbols-outlined text-base" style={mobilePanel === "timer" ? { fontVariationSettings: "'FILL' 1" } : undefined}>timer</span>
              <span>Timer</span>
            </button>
            <button
              onClick={() => setMobilePanel("sensei")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-all ${
                mobilePanel === "sensei"
                  ? "bg-[#4b4166] text-[#cdc0ec]"
                  : "text-[#767575]"
              }`}
            >
              <span className="material-symbols-outlined text-base" style={mobilePanel === "sensei" ? { fontVariationSettings: "'FILL' 1" } : undefined}>school</span>
              <span>Sensei</span>
            </button>
          </div>
        </header>

        {/* ── MOBILE: Timer panel ── */}
        {mobilePanel === "timer" && (
          <div className="flex-1 flex flex-col min-h-0 px-4 pb-6 gap-4">

            {/* Ring + time */}
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="relative flex items-center justify-center">
                {/* Outer glow */}
                <div className="absolute inset-0 rounded-full bg-[#cdc0ec]/5 blur-2xl scale-150 pointer-events-none" />

                <svg width={180} height={180} className="-rotate-90">
                  <circle
                    cx={90} cy={90} r={RING_R}
                    fill="none"
                    stroke="#2a2a2a"
                    strokeWidth={6}
                  />
                  <circle
                    cx={90} cy={90} r={RING_R}
                    fill="none"
                    stroke="#cdc0ec"
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - progress)}
                    className="transition-all duration-1000 ease-linear"
                  />
                </svg>

                {/* Center content */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-['Manrope'] text-5xl font-light tracking-tight text-[#cdc0ec]">
                    {formatTime(timeLeft)}
                  </span>
                  <span className="text-[9px] uppercase tracking-[0.25em] text-[#767575] mt-1">
                    {isRunning ? "Focused" : "Paused"}
                  </span>
                </div>
              </div>

              {/* Session meta below ring */}
              <div className="mt-5 flex items-center gap-3 text-xs text-[#767575]">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm text-[#8fa1a1]">schedule</span>
                  {session.duration_minutes}m
                </span>
                <span className="text-[#3a3a3a]">•</span>
                <span className="capitalize">{session.task_type}</span>
                <span className="text-[#3a3a3a]">•</span>
                <span>Day {state.dayIndex + 1}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="shrink-0 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setIsRunning((c) => !c)}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] py-4 text-sm font-semibold text-[#e7e5e5] active:scale-95 transition-all"
                >
                  <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {isRunning ? "pause" : "play_arrow"}
                  </span>
                  {isRunning ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => { setTimeLeft(session.duration_minutes * 60); setIsRunning(true); }}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] py-4 text-sm font-semibold text-[#e7e5e5] active:scale-95 transition-all"
                >
                  <span className="material-symbols-outlined text-xl">replay</span>
                  Restart
                </button>
              </div>

              <button
                onClick={handleCompleteSession}
                disabled={isCompleting}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#cdc0ec] to-[#bfb2de] py-4 text-sm font-bold text-[#443b5f] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#cdc0ec]/10"
              >
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
                {isCompleting ? "Completing..." : "Mark Complete"}
              </button>

              {completionError && (
                <p className="text-center text-sm text-[#ec7c8a]">{completionError}</p>
              )}
            </div>
          </div>
        )}

        {/* ── MOBILE: Sensei panel ── */}
        {mobilePanel === "sensei" && (
          <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e]">

            {/* Sensei mini-header */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#1e1e1e]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#4b4166]/30 flex items-center justify-center overflow-hidden">
                  <img src={senseiLogo} alt="Sensei" className="w-7 h-7 object-contain" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#e7e5e5]">Sensei AI</p>
                  <p className="text-[9px] text-[#8fa1a1]">
                    {contentLoading ? "Loading..." : `Ready · ${topic}`}
                  </p>
                </div>
              </div>
              {activeTab === "Chat" && (
                <button onClick={handleClearChat} className="flex items-center gap-1 text-[11px] text-[#ec7c8a]">
                  <span className="material-symbols-outlined text-sm">delete</span>
                  Erase
                </button>
              )}
            </div>

            {/* Tab bar */}
            <div className="shrink-0 flex border-b border-[#1e1e1e] px-4">
              {SENSEI_TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 -mb-[1px] ${
                    activeTab === tab
                      ? "border-[#cdc0ec] text-[#e7e5e5]"
                      : "border-transparent text-[#767575]"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Content */}
            {senseiContent}

            {/* Chat input */}
            {activeTab === "Chat" && (
              <div className="shrink-0 border-t border-[#1e1e1e] p-3">
                <div className="flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#141414] px-3 py-2.5">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder={`Ask about ${topic.toLowerCase()}...`}
                    rows={1}
                    disabled={chatSending}
                    className="flex-1 resize-none bg-transparent text-sm text-[#e7e5e5] placeholder-[#767575] outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={chatSending || !chatInput.trim()}
                    className="shrink-0 w-8 h-8 rounded-lg bg-[#4b4166] flex items-center justify-center disabled:opacity-40 transition-opacity active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[#cdc0ec] text-base" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════
          DESKTOP LAYOUT  (hidden below md)
      ════════════════════════════════════════ */}
      <div className="hidden md:flex flex-1 min-h-0 p-5 lg:p-7 gap-5 lg:gap-6">

        {/* ── LEFT: Timer panel ── */}
        <section className="flex min-h-0 flex-col rounded-2xl border-2 border-[#2a2a2a] bg-[#131313] p-6 lg:p-8 md:w-[52%] lg:w-[55%]">

          {/* Header */}
          <div className="shrink-0 mb-6 flex items-start justify-between gap-4">
            <div className="space-y-3">
              <button
                onClick={() => navigate("/dashboard")}
                className="inline-flex items-center gap-1.5 text-sm text-[#767575] hover:text-[#acabaa] transition-colors"
              >
                <span className="material-symbols-outlined text-base">arrow_back</span>
                Dashboard
              </button>
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-[#8fa1a1]">Study Mode</p>
                <h1 className="mt-1.5 font-['Manrope'] text-2xl lg:text-3xl font-light text-[#cdc0ec] leading-snug">
                  {session.title}
                </h1>
                <p className="mt-1.5 text-sm text-[#767575]">
                  {state.courseName} · Day {state.dayIndex + 1} · {session.task_type}
                </p>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#0e0e0e] px-3.5 py-2.5">
              <span className="material-symbols-outlined text-sm text-[#767575]">schedule</span>
              <div>
                <p className="text-[9px] uppercase tracking-widest text-[#767575]">Duration</p>
                <p className="text-sm font-semibold text-[#cdc0ec]">{session.duration_minutes} min</p>
              </div>
            </div>
          </div>

          {/* Timer display */}
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(205,192,236,0.05),_transparent_65%)] pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center gap-6">
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#8fa1a1] font-medium">Focus Timer</p>

              <div className="font-['Manrope'] text-8xl lg:text-9xl font-light tracking-tight text-[#cdc0ec] mb-2">
                {formatTime(timeLeft)}
              </div>
              <div className="h-1 w-32 bg-gradient-to-r from-transparent via-[#cdc0ec]/30 to-transparent rounded-full mb-2" />

              <p className="max-w-lg text-sm leading-relaxed text-[#acabaa] text-center">
                Stay focused on {topic.toLowerCase()} for this session.
              </p>
            </div>

            {/* Controls */}
            <div className="relative z-10 mt-8 flex items-center gap-3">
              <button
                onClick={() => setIsRunning((c) => !c)}
                className="inline-flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#131313] px-5 py-2.5 text-sm font-semibold text-[#e7e5e5] hover:border-[#cdc0ec]/30 hover:bg-[#1a1a1a] active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {isRunning ? "pause" : "play_arrow"}
                </span>
                {isRunning ? "Pause" : "Resume"}
              </button>
              <button
                onClick={() => { setTimeLeft(session.duration_minutes * 60); setIsRunning(true); }}
                className="inline-flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#131313] px-5 py-2.5 text-sm font-semibold text-[#e7e5e5] hover:border-[#cdc0ec]/30 hover:bg-[#1a1a1a] active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-lg">replay</span>
                Restart
              </button>
              <button
                onClick={handleCompleteSession}
                disabled={isCompleting}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#cdc0ec] to-[#bfb2de] px-5 py-2.5 text-sm font-bold text-[#443b5f] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#cdc0ec]/10"
              >
                <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                {isCompleting ? "Completing..." : "Complete"}
              </button>
            </div>

            {completionError && (
              <p className="relative z-10 mt-3 text-sm text-[#ec7c8a]">{completionError}</p>
            )}
          </div>
        </section>

        {/* ── RIGHT: Sensei panel ── */}
        <aside className="flex min-h-0 flex-col rounded-2xl border-2 border-[#2a2a2a] bg-[#131313] md:w-[48%] lg:w-[45%]">

          {/* Sensei header */}
          <div className="shrink-0 flex items-center justify-between px-5 lg:px-6 py-5 lg:py-6 border-b border-[#1e1e1e]">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-[#4b4166]/25 flex items-center justify-center overflow-hidden">
                <img src={senseiLogo} alt="Sensei" className="w-10 h-10 object-contain" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#e7e5e5]">Sensei AI</p>
                <p className="text-[11px] text-[#8fa1a1]">
                  {contentLoading ? "Loading topic guidance..." : `Ready · ${topic}`}
                </p>
              </div>
            </div>
            {activeTab === "Chat" && (
              <button
                onClick={handleClearChat}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-[#ec7c8a] hover:bg-[#ec7c8a]/10 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
                Erase
              </button>
            )}
          </div>

          {/* Tab bar */}
          <div className="shrink-0 flex border-b border-[#1e1e1e] px-5 lg:px-6">
            {SENSEI_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-4 mr-6 text-sm font-medium border-b-2 -mb-[1px] transition-colors ${
                  activeTab === tab
                    ? "border-[#cdc0ec] text-[#e7e5e5]"
                    : "border-transparent text-[#767575] hover:text-[#acabaa]"
                }`}
              >
                {tab === "Practice" ? "Practice Questions" : tab}
              </button>
            ))}
          </div>

          {/* Content area */}
          {senseiContent}

          {/* Chat input */}
          {activeTab === "Chat" && (
            <div className="shrink-0 border-t border-[#1e1e1e] p-4 lg:p-5">
              <div className="flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#0e0e0e] px-4 py-3">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  placeholder={`Ask Sensei about ${topic.toLowerCase()}...`}
                  rows={1}
                  disabled={chatSending}
                  className="flex-1 resize-none bg-transparent text-sm text-[#e7e5e5] placeholder-[#767575] outline-none disabled:opacity-50"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={chatSending || !chatInput.trim()}
                  className="shrink-0 w-8 h-8 rounded-lg bg-[#4b4166] flex items-center justify-center disabled:opacity-40 transition-opacity active:scale-95"
                >
                  <span className="material-symbols-outlined text-[#cdc0ec] text-base" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-[#484848]">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          )}
        </aside>

      </div>
    </div>
  );
}
