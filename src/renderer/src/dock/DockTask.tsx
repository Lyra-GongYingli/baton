import { useEffect, type CSSProperties } from 'react'
import { expandPrompt } from '../../../shared/prompt'
import { api, useData } from '../api'
import { SubtaskRoute } from '../board/SubtaskRoute'
import { InlineEdit } from '../components/InlineEdit'
import { PromptBox } from '../components/PromptBox'
import { TaskStatusPicker } from '../components/TaskStatusPicker'
import { cx, titleFromText } from '../util'
import { Icon, toast, useDropTarget } from './parts'

/** 侧边栏里的任务：一个子任务 list，每一行填提示词 */
export function DockTask({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail] = useData(() => api.getTask(id), [id])

  useEffect(() => {
    api.setCurrentTask(id)
  }, [id])

  // 扔到任务任意空白处 = 加一个子任务，扔进来的文字就是提示词
  const drop = useDropTarget(async (text) => {
    await api.createSubtask(id, { title: titleFromText(text), prompt: text })
    toast('✓ 加了一个子任务')
  })

  if (detail === undefined) return null
  if (detail === null) {
    return (
      <div className="dtask">
        <button className="back-btn" onClick={onBack}>
          <Icon.back /> 返回
        </button>
        <p className="muted">这个任务不存在了。</p>
      </div>
    )
  }

  const { project, task, subtasks } = detail
  const done = subtasks.filter((s) => s.status === 'done').length

  return (
    <div className={cx('dtask', drop.over && 'drop-over')} style={{ '--c': project.color } as CSSProperties} {...drop.props}>
      <div className="dtask-top">
        <button className="back-btn" onClick={onBack} title="返回">
          <Icon.back />
        </button>
        <span className="dtask-crumb">
          <span className="dtask-dot" />
          {project.title}
        </span>
        <div className="spacer" />
        <TaskStatusPicker taskId={task.id} value={task.status} />
      </div>
      <h2 className="dtask-title">
        <InlineEdit value={task.title} placeholder="任务名" onSave={(title) => api.updateTask(task.id, { title })} />
      </h2>
      <div className="dtask-goal">
        <InlineEdit value={task.goal} placeholder="写个目标（可选）" onSave={(goal) => api.updateTask(task.id, { goal })} />
      </div>

      <div className="task-prompt">
        <div className="dsection-title">任务提示词</div>
        <PromptBox
          value={task.prompt}
          placeholder="点这里填这个任务的提示词…"
          copyText={expandPrompt(task.prompt, task)}
          onSave={(prompt) => api.updateTask(task.id, { prompt })}
        />
      </div>

      <div className="dsection-title">
        子任务
        <span className="muted">
          {done}/{subtasks.length}
        </span>
        <span className="legend">
          <i className="lg-chain" />
          接力
          <i className="lg-solo" />
          独立
        </span>
      </div>
      <SubtaskRoute detail={detail} />

      <p className="dtask-tip">
        提示词点一下就能写，双击复制。把文字拖到这里会新建一个子任务；拖到某个子任务上，会变成它的子子任务。
      </p>
      {drop.over && <div className="dtask-drop">松手，加一个子任务</div>}
    </div>
  )
}
