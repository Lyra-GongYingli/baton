import { useEffect, type CSSProperties } from 'react'
import { api, useData } from '../api'
import { TaskBody } from '../board/TaskBody'
import { TaskStatusPicker } from '../components/StatusPicker'
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

  const { project, task } = detail

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
      <TaskBody detail={detail} />
      {drop.over && <div className="dtask-drop">松手，加一个子任务</div>}
    </div>
  )
}
