import React from "react"
import { Calendar, Play, Square, Clock, CheckCircle2, XCircle } from "lucide-react"
import type { ScheduledAgent } from "../../lib/agentBrowsing/autonomousAgents"
import { describeCron } from "../../lib/agentBrowsing/autonomousAgents"
import { authFetch } from "../../lib/firebase"

interface AgentSchedulerPanelProps {
  agents: ScheduledAgent[]
  onUpdate: () => void
}

export function AgentSchedulerPanel({ agents, onUpdate }: AgentSchedulerPanelProps) {
  const handleTrigger = async (agentId: string) => {
    try {
      await authFetch(`/api/agents-browser/schedules/${encodeURIComponent(agentId)}/trigger`, { method: "POST" })
      onUpdate()
    } catch (err) {
      console.error("Trigger failed:", err)
    }
  }

  const handleToggle = async (agent: ScheduledAgent) => {
    try {
      await authFetch(`/api/agents-browser/schedules/${encodeURIComponent(agent.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !agent.enabled }),
      })
      onUpdate()
    } catch (err) {
      console.error("Toggle failed:", err)
    }
  }

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-5 h-5 text-blue-400" />
        <h2 className="text-lg font-semibold text-white">Agent Schedules</h2>
        <span className="text-xs text-slate-500 ml-auto">{agents.length} agents</span>
      </div>

      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {agents.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No agents registered</p>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-white/5 border border-white/5 rounded-lg p-4 hover:border-white/10 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-white truncate">{agent.name}</h3>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        agent.enabled
                          ? "bg-emerald-900/50 text-emerald-300"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {agent.enabled ? "active" : "paused"}
                    </span>
                    {agent.status === "running" && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900/50 text-blue-300">
                        <Clock className="w-2.5 h-2.5 animate-pulse" />
                        running
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">{agent.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[11px] text-slate-500 font-mono">{agent.cronExpression}</span>
                    <span className="text-[11px] text-slate-600">{describeCron(agent.cronExpression)}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      {agent.successCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <XCircle className="w-3 h-3 text-red-500" />
                      {agent.failureCount}
                    </span>
                    {agent.lastRun && (
                      <span>
                        Last: {new Date(agent.lastRun).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 ml-4">
                  <button
                    onClick={() => handleTrigger(agent.id)}
                    disabled={agent.status === "running"}
                    className="p-1.5 rounded-lg hover:bg-emerald-900/30 text-emerald-400 disabled:opacity-30 transition-colors"
                    title="Run now"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggle(agent)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      agent.enabled
                        ? "hover:bg-red-900/30 text-red-400"
                        : "hover:bg-emerald-900/30 text-emerald-400"
                    }`}
                    title={agent.enabled ? "Pause" : "Activate"}
                  >
                    <Square className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
