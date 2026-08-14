import React, { useEffect, useState } from "react"
import { Bot, Calendar, Activity, Loader2 } from "lucide-react"
import { authFetch } from "../../lib/firebase"
import type { ScheduledAgent } from "../../lib/agentBrowsing/autonomousAgents"
import type { AgentEvent } from "../../lib/agentBrowsing/eventBus"
import { EventBusMonitor } from "./EventBusMonitor"
import { AgentSchedulerPanel } from "./AgentSchedulerPanel"

interface SchedulerStats {
  totalAgents: number
  enabledAgents: number
  totalExecutions: number
  totalSuccesses: number
  totalFailures: number
}

function computeStats(agents: ScheduledAgent[]): SchedulerStats {
  return {
    totalAgents: agents.length,
    enabledAgents: agents.filter((a) => a.enabled).length,
    totalExecutions: agents.reduce((sum, a) => sum + (a.executionCount ?? 0), 0),
    totalSuccesses: agents.reduce((sum, a) => sum + (a.successCount ?? 0), 0),
    totalFailures: agents.reduce((sum, a) => sum + (a.failureCount ?? 0), 0),
  }
}

export default function AgentBrowserDashboard() {
  const [agents, setAgents] = useState<ScheduledAgent[]>([])
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const [agentsRes, eventsRes] = await Promise.all([
      authFetch("/api/agents-browser/agents"),
      authFetch("/api/agents-browser/events?limit=50"),
    ])
    if (agentsRes.ok) {
      const data = await agentsRes.json()
      setAgents(data.agents ?? [])
    }
    if (eventsRes.ok) {
      const data = await eventsRes.json()
      setEvents(data.events ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
    const interval = setInterval(() => void load(), 5000)
    return () => clearInterval(interval)
  }, [])

  const stats = computeStats(agents)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Agent Browser</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-black/40 border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <Bot className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-medium text-slate-400">Registered Agents</span>
          </div>
          <p className="text-3xl font-bold text-white">{stats.totalAgents}</p>
          <p className="text-xs text-slate-500 mt-1">{stats.enabledAgents} enabled</p>
        </div>

        <div className="bg-black/40 border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <Calendar className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-medium text-slate-400">Active Schedules</span>
          </div>
          <p className="text-3xl font-bold text-white">{stats.enabledAgents}</p>
          <p className="text-xs text-slate-500 mt-1">{stats.totalExecutions} total runs</p>
        </div>

        <div className="bg-black/40 border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <Activity className="w-5 h-5 text-purple-400" />
            <span className="text-sm font-medium text-slate-400">Execution Health</span>
          </div>
          <p className="text-3xl font-bold text-white">{stats.totalSuccesses}</p>
          <p className="text-xs text-slate-500 mt-1">{stats.totalFailures} failures</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AgentSchedulerPanel agents={agents} onUpdate={() => void load()} />
        <EventBusMonitor events={events} />
      </div>
    </div>
  )
}
