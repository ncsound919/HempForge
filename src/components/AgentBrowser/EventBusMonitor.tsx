import React from "react"
import { Activity, AlertTriangle, CheckCircle2, Info, Zap } from "lucide-react"
import type { AgentEvent } from "../../lib/agentBrowsing/eventBus"

interface EventBusMonitorProps {
  events: AgentEvent[]
}

const typeIcons: Record<string, React.ReactNode> = {
  "agent:completed": <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  "agent:failed": <AlertTriangle className="w-3.5 h-3.5 text-red-400" />,
  "agent:started": <Zap className="w-3.5 h-3.5 text-yellow-400" />,
  error: <AlertTriangle className="w-3.5 h-3.5 text-red-400" />,
}

function getIcon(type: string): React.ReactNode {
  return typeIcons[type] || <Info className="w-3.5 h-3.5 text-slate-400" />
}

function getTypeColor(type: string): string {
  if (type.includes("completed")) return "text-emerald-400"
  if (type.includes("failed") || type === "error") return "text-red-400"
  if (type.includes("started")) return "text-yellow-400"
  if (type.includes("trigger")) return "text-purple-400"
  return "text-slate-300"
}

export function EventBusMonitor({ events }: EventBusMonitorProps) {
  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-semibold text-white">Recent Events</h2>
        <span className="text-xs text-slate-500 ml-auto">{events.length} events</span>
      </div>

      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No events yet</p>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              <div className="mt-0.5">{getIcon(event.type)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${getTypeColor(event.type)}`}>
                    {event.type}
                  </span>
                  <span className="text-xs text-slate-500 truncate">{event.source}</span>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {JSON.stringify(event.payload).slice(0, 120)}
                </p>
              </div>
              <span className="text-xs text-slate-600 whitespace-nowrap">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
