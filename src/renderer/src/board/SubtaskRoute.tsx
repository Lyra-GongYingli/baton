import { useState, type CSSProperties } from 'react'
import { nextStatus } from '../../../shared/agents'
import { expandPrompt, previousOf } from '../../../shared/prompt'
import { STATUS_LABEL, type Subtask, type TaskDetail } from '../../../shared/types'
import { api } from '../api'
import { AgentPicker } from '../components/AgentPicker'
import { InlineEdit, renderPrompt } from '../components/InlineEdit'
import { SortableList, type DragHandle } from '../components/Sortable'
import { PromptPill, toast, useDropTarget } from '../dock/parts'
import { cx, titleFromText } from '../util'

// 子任务 list：每一行是一个子任务 + 它的提示词，下面可以挂一串子子任务。
//   接力子任务（chained）——和上一个用实线连着，圆形节点，上一个完成后才轮到它
//   独立子任务 ——和上一个断开，方形节点，随时可以做
// 标题、提示词点一下就能改，双击复制；两行之间的连接处点一下接上 / 断开；整行按住拖动排序。

export function SubtaskRoute({ detail }: { detail: TaskDetail }) {
  const { subtasks, task } = detail
  const currentId = subtasks.find((s) => s.status !== 'done')?.id

  return (
    <div className="route" style={{ '--c': detail.project.color } as CSSProperties}>
      <SortableList
        items={subtasks}
        getId={(s) => s.id}
        onReorder={(ids) => api.reorderSubtasks(task.id, ids)}
        renderItem={(s, drag) => {
          const index = subtasks.findIndex((x) => x.id === s.id)
          return (
            <Stop
              s={s}
              detail={detail}
              first={index === 0}
              startsChain={Boolean(subtasks[index + 1]?.chained)}
              current={s.id === currentId}
              drag={drag}
            />
          )
        }}
      />
      <AddStop taskId={task.id} hasAny={subtasks.length > 0} />
    </div>
  )
}

function Stop({
  s,
  detail,
  first,
  startsChain,
  current,
  drag
}: {
  s: Subtask
  detail: TaskDetail
  first: boolean
  /** 下一个子任务接着它做：它是一条接力链的起点，也画成圆形 */
  startsChain: boolean
  current: boolean
  drag: DragHandle
}) {
  const [adding, setAdding] = useState(false)
  const prev = previousOf(s, detail.subtasks)
  const chained = s.chained && !first
  const waiting = prev && prev.status !== 'done'
  const busy = s.status === 'ai_running' || s.status === 'doing'
  const next = nextStatus(s.agent, s.status)

  // 把文字扔到这个子任务上 = 加一个子子任务，文字就是它的提示词
  const drop = useDropTarget(async (text) => {
    await api.createSubtask(s.taskId, { parentId: s.id, title: titleFromText(text), prompt: text })
    toast(`✓ 在 S${s.ref} 下面加了一个子子任务`)
  })

  return (
    <div
      ref={drag.setNodeRef}
      style={drag.style}
      className={cx(
        'stop',
        `s-${s.status}`,
        chained || startsChain ? 'chained' : 'solo',
        current && 'current',
        drag.isDragging && 'lifted',
        drop.over && 'drop-over'
      )}
      {...drop.props}
    >
      {!first && (
        <button
          className={cx('link', chained ? 'on' : 'off', prev?.status === 'done' && 'lit')}
          title={chained ? '接力中：上一个完成后才轮到它。点一下断开' : '独立的。点一下和上一个接起来'}
          onClick={() => api.updateSubtask(s.id, { chained: !s.chained })}
        >
          <span className="link-line" />
          <span className="link-chip">{chained ? '接力' : '＋ 接上'}</span>
        </button>
      )}

      <div className="stop-main" {...drag.attributes} {...drag.listeners}>
        <button
          className="stop-node"
          title={`${STATUS_LABEL[s.status]} → 点一下变成「${STATUS_LABEL[next]}」`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => api.updateSubtask(s.id, { status: next })}
        >
          <span key={s.status} className="node-core" />
        </button>

        <div className="stop-body">
          <div className="stop-title">
            <span className="ref">S{s.ref}</span>
            <InlineEdit value={s.title} placeholder="子任务名" onSave={(title) => api.updateSubtask(s.id, { title })} />
          </div>

          <div className="stop-meta">
            <span className={cx('now-status', `s-${s.status}`)}>{STATUS_LABEL[s.status]}</span>
            {chained && prev && (
              <span className={cx('carry', waiting && 'waiting')}>
                {waiting ? `🔒 等 S${prev.ref} 完成` : `↳ 接着 S${prev.ref}`}
              </span>
            )}
            {s.children.length > 0 && (
              <span className="muted">
                {s.children.filter((c) => c.status === 'done').length}/{s.children.length} 个子子任务
              </span>
            )}
          </div>

          <InlineEdit
            multiline
            className="prompt-field"
            value={s.prompt}
            placeholder="点这里填提示词…"
            copyText={expandPrompt(s.prompt, detail.task)}
            render={renderPrompt}
            onSave={(prompt) => api.updateSubtask(s.id, { prompt })}
          />

          {s.prompt && (
            <div className="stop-actions">
              <PromptPill compact label="复制提示词" text={expandPrompt(s.prompt, detail.task)} />
            </div>
          )}
          {drop.over && <div className="stop-drop">加一个 S{s.ref} 的子子任务</div>}
        </div>

        <div className="stop-side">
          <AgentPicker value={s.agent} busy={busy} onChange={(agent) => api.assignSubtask(s.id, agent)} />
          <button
            className="row-add"
            title="加子子任务"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setAdding(true)}
          >
            ＋
          </button>
          <button
            className="row-del"
            title="删除这个子任务"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              const extra = s.children.length ? `和它的 ${s.children.length} 个子子任务` : ''
              if (confirm(`删除 S${s.ref}「${s.title}」${extra}？`)) api.deleteSubtask(s.id)
            }}
          >
            ×
          </button>
        </div>
      </div>

      {(s.children.length > 0 || adding) && (
        <Children parent={s} detail={detail} adding={adding} onDoneAdding={() => setAdding(false)} />
      )}
    </div>
  )
}

/** 子子任务清单：勾选框 + 标题 + 提示词，可以拖动排序 */
function Children({
  parent,
  detail,
  adding,
  onDoneAdding
}: {
  parent: Subtask
  detail: TaskDetail
  adding: boolean
  onDoneAdding: () => void
}) {
  const [title, setTitle] = useState('')
  return (
    <div className="children">
      <SortableList
        items={parent.children}
        getId={(c) => c.id}
        onReorder={(ids) => api.reorderSubtasks(parent.taskId, ids)}
        renderItem={(c, drag) => (
          <ChildRow c={c} label={`S${parent.ref}.${parent.children.indexOf(c) + 1}`} detail={detail} drag={drag} />
        )}
      />
      {adding && (
        <div className="child add">
          <span className="child-check" />
          <input
            autoFocus
            value={title}
            placeholder="子子任务，回车继续加，esc 结束"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => !title.trim() && onDoneAdding()}
            onKeyDown={async (e) => {
              if (e.key === 'Escape') onDoneAdding()
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && title.trim()) {
                await api.createSubtask(parent.taskId, { parentId: parent.id, title })
                setTitle('')
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

function ChildRow({ c, label, detail, drag }: { c: Subtask; label: string; detail: TaskDetail; drag: DragHandle }) {
  const done = c.status === 'done'
  const prompt = (
    <InlineEdit
      multiline
      className={cx('prompt-field', 'mini')}
      value={c.prompt}
      placeholder="＋ 提示词"
      copyText={expandPrompt(c.prompt, detail.task)}
      render={renderPrompt}
      onSave={(value) => api.updateSubtask(c.id, { prompt: value })}
    />
  )
  return (
    <div
      ref={drag.setNodeRef}
      style={drag.style}
      className={cx('child', done && 'done', drag.isDragging && 'lifted')}
      {...drag.attributes}
      {...drag.listeners}
    >
      <button
        className="child-check"
        title={done ? '标记为没做完' : '标记为做完'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => api.updateSubtask(c.id, { status: done ? 'todo' : 'done' })}
      >
        {done && '✓'}
      </button>
      <div className="child-body">
        <div className="child-title">
          <span className="ref">{label}</span>
          <InlineEdit value={c.title} placeholder="子子任务名" onSave={(title) => api.updateSubtask(c.id, { title })} />
          {/* 没填提示词时，「＋ 提示词」跟在标题后面，不多占一行 */}
          {!c.prompt && prompt}
        </div>
        {c.prompt && prompt}
      </div>
      {c.prompt && <PromptPill compact label="复制" text={expandPrompt(c.prompt, detail.task)} />}
      <button
        className="row-del"
        title="删除这个子子任务"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          if (confirm(`删除「${c.title}」？`)) api.deleteSubtask(c.id)
        }}
      >
        ×
      </button>
    </div>
  )
}

function AddStop({ taskId, hasAny }: { taskId: string; hasAny: boolean }) {
  const [title, setTitle] = useState('')
  const [chained, setChained] = useState(false)
  return (
    <div className={cx('stop add', chained && hasAny ? 'chained' : 'solo')}>
      {hasAny && (
        <button
          className={cx('link', chained ? 'on' : 'off')}
          title={chained ? '新子任务会接着上一个做' : '新子任务是独立的'}
          onClick={() => setChained(!chained)}
        >
          <span className="link-line" />
          <span className="link-chip">{chained ? '接力' : '＋ 接上'}</span>
        </button>
      )}
      <div className="stop-main">
        <span className="stop-node">
          <span className="node-core" />
        </span>
        <input
          value={title}
          placeholder={chained && hasAny ? '加一个接力子任务，回车' : '加一个子任务，回车'}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && title.trim()) {
              await api.createSubtask(taskId, { title, chained: chained && hasAny })
              setTitle('')
            }
          }}
        />
      </div>
    </div>
  )
}
