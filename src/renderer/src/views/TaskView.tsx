import type { CSSProperties } from 'react'
import { expandPrompt } from '../../../shared/prompt'
import { api, useData } from '../api'
import { SubtaskRoute } from '../board/SubtaskRoute'
import { Editable } from '../components/Editable'
import { PromptBox } from '../components/PromptBox'
import { TaskStatusPicker } from '../components/TaskStatusPicker'

/** 大窗口里的任务：所有字段都能编辑 */
export function TaskView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [detail] = useData(() => api.getTask(id), [id])
  const [trees] = useData(() => api.listProjects(), [])

  if (detail === undefined) return <div className="page" />
  if (detail === null) return <div className="page muted">这个任务不存在了。</div>

  const { project, task, subtasks } = detail

  const remove = async (): Promise<void> => {
    if (!confirm(`删除任务「${task.title}」？子任务会一起删掉。`)) return
    await api.deleteTask(task.id)
    onDeleted()
  }

  return (
    <div className="page thread-page" style={{ '--c': project.color } as CSSProperties}>
      <div className="task-crumb">
        <span className="thread-header-dot" />
        <select
          className="crumb-select"
          value={project.id}
          title="移到别的项目"
          onChange={(e) => api.moveTask(task.id, e.target.value, 0)}
        >
          {(trees ?? []).map((t) => (
            <option key={t.project.id} value={t.project.id}>
              {t.project.title}
            </option>
          ))}
        </select>
      </div>
      <header className="thread-header">
        <Editable className="thread-title" value={task.title} onSave={(title) => api.updateTask(task.id, { title })} />
        <div className="thread-header-actions">
          <TaskStatusPicker taskId={task.id} value={task.status} />
          <button className="btn ghost danger" onClick={remove}>
            删除
          </button>
        </div>
      </header>

      <div className="thread-meta">
        <label className="meta-field">
          <span>目标</span>
          <Editable
            multiline
            rows={1}
            value={task.goal}
            placeholder="做完之后是什么样子？"
            onSave={(goal) => api.updateTask(task.id, { goal })}
          />
        </label>
        <label className="meta-field">
          <span>完成标准</span>
          <Editable
            multiline
            rows={1}
            value={task.doneCriteria}
            placeholder="怎样算做完？"
            onSave={(doneCriteria) => api.updateTask(task.id, { doneCriteria })}
          />
        </label>
      </div>

      <section className="task-prompt">
        <h2 className="section-title">任务提示词</h2>
        <PromptBox
          value={task.prompt}
          placeholder="点这里填这个任务的提示词…"
          copyText={expandPrompt(task.prompt, task)}
          onSave={(prompt) => api.updateTask(task.id, { prompt })}
        />
      </section>

      <section>
        <h2 className="section-title">
          子任务 <span className="muted small">{subtasks.filter((s) => s.status === 'done').length}/{subtasks.length}</span>
          <span className="legend">
            <i className="lg-chain" />
            接力（上一个完成后才轮到它）
            <i className="lg-solo" />
            独立
          </span>
        </h2>
        <div className="route-card">
          <SubtaskRoute detail={detail} />
        </div>
        <p className="muted small route-tip">
          提示词点一下就能写，双击复制。整行按住可以拖动排序，两行之间的连接处点一下接上或断开；鼠标移到子任务上，右侧的「＋」可以往下再拆一层子子任务。
        </p>
      </section>
    </div>
  )
}
