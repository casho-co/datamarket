"use client";

import { useEffect, useState } from "react";

interface FeedEvent {
  id: string;
  event_type: string;
  job_id: string | null;
  payload: Record<string, any>;
  created_at: string;
}

const eventConfig: Record<string, { icon: string; color: string }> = {
  job_created: { icon: "plus", color: "green" },
  bid_placed: { icon: "tag", color: "blue" },
  job_awarded: { icon: "target", color: "yellow" },
  work_submitted: { icon: "package", color: "purple" },
  job_completed: { icon: "check", color: "accent" },
  job_cancelled: { icon: "x", color: "red" },
  job_expired: { icon: "clock", color: "zinc" },
  dispute_opened: { icon: "scale", color: "red" },
  dispute_resolved: { icon: "gavel", color: "orange" },
  auto_dispute: { icon: "bot", color: "red" },
  message_created: { icon: "message", color: "blue" },
  competition_entry: { icon: "trophy", color: "yellow" },
  competition_resolved: { icon: "medal", color: "accent" },
  assignment_overdue: { icon: "alert", color: "orange" },
};

function EventIcon({ type }: { type: string }) {
  const config = eventConfig[type];
  const colorMap: Record<string, string> = {
    green: "bg-green-500/10 border-green-500/20 text-green-400",
    blue: "bg-blue-500/10 border-blue-500/20 text-blue-400",
    yellow: "bg-yellow-500/10 border-yellow-500/20 text-yellow-400",
    purple: "bg-purple-500/10 border-purple-500/20 text-purple-400",
    accent: "bg-accent/10 border-accent/20 text-accent",
    red: "bg-red-500/10 border-red-500/20 text-red-400",
    zinc: "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
    orange: "bg-orange-500/10 border-orange-500/20 text-orange-400",
  };
  const c = colorMap[config?.color || "zinc"] || colorMap.zinc;

  return (
    <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${c}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {config?.icon === "plus" && <path d="M12 5v14M5 12h14" />}
        {config?.icon === "tag" && <><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>}
        {config?.icon === "target" && <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>}
        {config?.icon === "package" && <><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>}
        {config?.icon === "check" && <polyline points="20 6 9 17 4 12" />}
        {config?.icon === "x" && <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>}
        {config?.icon === "clock" && <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>}
        {config?.icon === "scale" && <><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></>}
        {config?.icon === "gavel" && <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />}
        {config?.icon === "bot" && <><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></>}
        {config?.icon === "message" && <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />}
        {config?.icon === "trophy" && <><path d="M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22M18 2H6v7a6 6 0 1012 0V2z" /></>}
        {config?.icon === "medal" && <><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" /></>}
        {config?.icon === "alert" && <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>}
        {!config && <><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></>}
      </svg>
    </div>
  );
}

export default function FeedPage() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const evtSource = new EventSource("/feed/events");

    evtSource.onopen = () => setConnected(true);
    evtSource.onerror = () => setConnected(false);

    const eventTypes = Object.keys(eventConfig);
    for (const type of eventTypes) {
      evtSource.addEventListener(type, (e) => {
        try {
          const data = JSON.parse(e.data);
          setEvents((prev) => [data, ...prev].slice(0, 100));
        } catch {
          // ignore
        }
      });
    }

    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [data, ...prev].slice(0, 100));
      } catch {
        // ignore
      }
    };

    return () => evtSource.close();
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Live Feed</h1>
          <p className="text-sm text-muted mt-1">Real-time marketplace activity</p>
        </div>
        <div className="flex items-center gap-2 bg-surface border border-border rounded-full px-3 py-1.5">
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-green-400 animate-pulse-dot" : "bg-red-400"}`}
          />
          <span className="text-xs text-muted">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {events.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-muted font-medium">Waiting for events...</p>
            <p className="text-sm text-muted mt-1">Activity will appear here in real-time</p>
          </div>
        )}
        {events.map((event) => (
          <div
            key={event.id}
            className="bg-surface border border-border rounded-xl p-4 animate-fade-in-up"
          >
            <div className="flex items-start gap-3">
              <EventIcon type={event.event_type} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold">
                    {event.event_type.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(event.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted">
                  {event.payload?.title && (
                    <span className="truncate">{event.payload.title}</span>
                  )}
                  {event.payload?.amount && (
                    <span className="font-mono text-accent font-medium">
                      {event.payload.amount} USDC
                    </span>
                  )}
                  {event.job_id && (
                    <a
                      href={`/jobs/${event.job_id}`}
                      className="text-accent hover:underline font-medium shrink-0"
                    >
                      View Job
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
