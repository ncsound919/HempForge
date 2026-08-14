import { eventBus } from './EventBus'
import { knowledgeStore } from './KnowledgeStore'
import { crossDomainAnalytics } from './CrossDomainAnalytics'
import { type ScienceEngine } from './ScienceEngine'
import { type BioPipelineEngine } from './BioPipelineEngine'

type TaskFn = (params: Record<string, any>) => Promise<Record<string, any>>

interface Task {
  id: string
  name: string
  execute: TaskFn
  dependencies: string[]
  params: Record<string, any>
  retryCount?: number
  timeout?: number
}

interface Workflow {
  id: string
  name: string
  description: string
  tasks: Task[]
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt?: string
  completedAt?: string
  results: Map<string, any>
  errors: Map<string, string>
}

export class WorkflowOrchestrator {
  private workflows: Map<string, Workflow> = new Map()
  private taskRegistry: Map<string, TaskFn> = new Map()
  private executingTasks: Set<string> = new Set()
  private maxConcurrent = 3

  private static instance: WorkflowOrchestrator | null = null

  private constructor() {}

  static getInstance(): WorkflowOrchestrator {
    if (!WorkflowOrchestrator.instance) WorkflowOrchestrator.instance = new WorkflowOrchestrator()
    return WorkflowOrchestrator.instance
  }

  registerTask(name: string, executor: TaskFn): void {
    this.taskRegistry.set(name, executor)
  }

  createWorkflow(params: { name: string; description: string; tasks: Array<{ name: string; params: Record<string, any>; dependencies: string[] }> }): string {
    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const tasks: Task[] = params.tasks.map((t, i) => ({
      id: `${id}_task_${i}`,
      name: t.name,
      execute: this.taskRegistry.get(t.name) || this.defaultExecutor(t.name),
      dependencies: t.dependencies,
      params: t.params,
      retryCount: 2,
      timeout: 30000,
    }))
    const workflow: Workflow = {
      id, name: params.name, description: params.description,
      tasks, status: 'pending', results: new Map(), errors: new Map(),
    }
    this.workflows.set(id, workflow)
    eventBus.emit('workflow.created', {
      domain: ['workflow'], source_system: 'workflow_orchestrator', subject_id: id,
      payload: { name: params.name, taskCount: tasks.length }, metadata: { taskCount: tasks.length },
    })
    return id
  }

  async executeWorkflow(workflowId: string): Promise<{ success: boolean; message: string }> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) return { success: false, message: 'Workflow not found' }
    workflow.status = 'running'
    workflow.startedAt = new Date().toISOString()
    eventBus.emit('workflow.started', {
      domain: ['workflow'], source_system: 'workflow_orchestrator', subject_id: workflowId,
      payload: { name: workflow.name }, metadata: {},
    })
    try {
      const taskGraph = this.buildTaskGraph(workflow)
      const executionOrder = this.topologicalSort(taskGraph)
      if (!executionOrder) {
        workflow.status = 'failed'
        return { success: false, message: 'Circular dependency detected' }
      }
      const completedTasks = new Set<string>()
      for (const batchIds of this.batchTasks(executionOrder, taskGraph, completedTasks)) {
        const batch = batchIds
          .map(id => workflow.tasks.find(t => t.id === id))
          .filter((t): t is Task => t !== undefined)
        const batchResults = await Promise.allSettled(
          batch.map(task => this.executeTask(task, workflow))
        )
        for (let i = 0; i < batch.length; i++) {
          const result = batchResults[i]
          const task = batch[i]
          if (result.status === 'fulfilled') {
            workflow.results.set(task.id, result.value)
            completedTasks.add(task.id)
          } else {
            workflow.errors.set(task.id, result.reason instanceof Error ? result.reason.message : String(result.reason))
            if (this.isCriticalPath(task, taskGraph, completedTasks)) {
              workflow.status = 'failed'
              workflow.completedAt = new Date().toISOString()
              eventBus.emit('workflow.failed', {
                domain: ['workflow'], source_system: 'workflow_orchestrator', subject_id: workflowId,
                payload: { error: result.reason instanceof Error ? result.reason.message : String(result.reason) },
                metadata: { failedTask: task.name },
              })
              return { success: false, message: `Task '${task.name}' failed: ${result.reason}` }
            }
          }
        }
      }
      workflow.status = 'completed'
      workflow.completedAt = new Date().toISOString()
      eventBus.emit('workflow.completed', {
        domain: ['workflow'], source_system: 'workflow_orchestrator', subject_id: workflowId,
        payload: { name: workflow.name, taskResults: Array.from(workflow.results.entries()) },
        metadata: { totalTasks: workflow.tasks.length, completedTasks: workflow.results.size, failedTasks: workflow.errors.size },
      })
      return { success: true, message: 'Workflow completed' }
    } catch (err) {
      workflow.status = 'failed'
      workflow.completedAt = new Date().toISOString()
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  private buildTaskGraph(workflow: Workflow): Map<string, string[]> {
    const graph = new Map<string, string[]>()
    for (const task of workflow.tasks) {
      graph.set(task.id, task.dependencies)
    }
    return graph
  }

  private topologicalSort(graph: Map<string, string[]>): string[] | null {
    const inDegree = new Map<string, number>()
    for (const [node] of graph) inDegree.set(node, 0)
    for (const [, deps] of graph) {
      for (const dep of deps) {
        inDegree.set(dep, (inDegree.get(dep) || 0) + 1)
      }
    }
    const queue: string[] = []
    for (const [node, degree] of inDegree) {
      if (degree === 0) queue.push(node)
    }
    const result: string[] = []
    while (queue.length > 0) {
      const node = queue.shift()!
      result.push(node)
      const deps = graph.get(node) || []
      for (const dep of deps) {
        const newDegree = (inDegree.get(dep) || 1) - 1
        inDegree.set(dep, newDegree)
        if (newDegree === 0) queue.push(dep)
      }
    }
    return result.length === graph.size ? result : null
  }

  private batchTasks(executionOrder: string[], graph: Map<string, string[]>, completedTasks: Set<string>): string[][] {
    const batches: string[][] = []
    const remaining = new Set(executionOrder)
    let prevSize = -1
    while (remaining.size > 0 && remaining.size !== prevSize) {
      prevSize = remaining.size
      const batch: string[] = []
      for (const taskId of remaining) {
        const deps = graph.get(taskId) || []
        if (deps.every(d => completedTasks.has(d))) {
          batch.push(taskId)
        }
      }
      for (const id of batch) remaining.delete(id)
      if (batch.length > 0) batches.push(batch)
    }
    if (remaining.size > 0) {
      batches.push(Array.from(remaining))
    }
    return batches
  }

  private async executeTask(task: Task, workflow: Workflow): Promise<Record<string, any>> {
    while (this.executingTasks.size >= this.maxConcurrent) {
      await new Promise(r => setTimeout(r, 100))
    }
    this.executingTasks.add(task.id)
    try {
      const result = await this.executeWithRetry(task)
      const envelope = eventBus.publish({
        event_type: 'task.completed', source_system: 'workflow_orchestrator',
        domain: ['workflow'], subject_id: task.id,
        metadata: { workflowId: workflow.id, taskName: task.name },
      })
      knowledgeStore.storeArtifact({
        event: envelope,
        content: result, content_type: 'application/json', created_by: 'workflow_orchestrator',
      })
      return result
    } finally {
      this.executingTasks.delete(task.id)
    }
  }

  private async executeWithRetry(task: Task): Promise<Record<string, any>> {
    const maxRetries = task.retryCount || 2
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Task ${task.name} timed out`)), task.timeout || 30000)
        })
        const result = await Promise.race([task.execute(task.params), timeoutPromise])
        return result
      } catch (err) {
        if (attempt === maxRetries) throw err
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500))
      }
    }
    throw new Error('Unreachable')
  }

  private isCriticalPath(task: Task, graph: Map<string, string[]>, completedTasks: Set<string>): boolean {
    const queue = [task.id]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const [nodeId, deps] of graph) {
        if (deps.includes(current) && !completedTasks.has(nodeId)) {
          return true
        }
      }
    }
    return false
  }

  private defaultExecutor(name: string): TaskFn {
    return async (params: Record<string, any>) => ({ executed: true, taskName: name, params, status: 'completed', timestamp: new Date().toISOString() })
  }

  getWorkflow(id: string): Workflow | undefined { return this.workflows.get(id) }

  getWorkflows(): Array<{ id: string; name: string; status: string; startedAt?: string }> {
    return Array.from(this.workflows.values()).map(w => ({ id: w.id, name: w.name, status: w.status, startedAt: w.startedAt }))
  }

  getStats(): { total: number; running: number; completed: number; failed: number } {
    let running = 0, completed = 0, failed = 0
    for (const w of this.workflows.values()) {
      if (w.status === 'running') running++
      else if (w.status === 'completed') completed++
      else if (w.status === 'failed') failed++
    }
    return { total: this.workflows.size, running, completed, failed }
  }
}

export const workflowOrchestrator = WorkflowOrchestrator.getInstance()
