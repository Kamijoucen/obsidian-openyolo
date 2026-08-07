import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleOff,
  ListTodo,
  Loader2,
} from 'lucide-react'
import { memo, useState } from 'react'

import { useLanguage } from '../../contexts/language-context'
import type { TodoEntry, TodoPriority, TodoStatus } from '../../types/chat'

function statusIcon(status: TodoStatus, label: string) {
  switch (status) {
    case 'completed':
      return (
        <CheckCircle2
          size={14}
          className="yolo-todo-panel__icon"
          aria-label={label}
        />
      )
    case 'in_progress':
      return (
        <Loader2
          size={14}
          className="yolo-todo-panel__icon yolo-todo-panel__icon-spin"
          aria-label={label}
        />
      )
    case 'cancelled':
      return (
        <CircleOff
          size={14}
          className="yolo-todo-panel__icon"
          aria-label={label}
        />
      )
    default:
      return (
        <CircleDashed
          size={14}
          className="yolo-todo-panel__icon"
          aria-label={label}
        />
      )
  }
}

function TodoPanel({ entries }: { entries: TodoEntry[] }) {
  const { t } = useLanguage()
  const [collapsed, setCollapsed] = useState(false)

  if (entries.length === 0) return null
  const done = entries.filter((entry) => entry.status === 'completed').length
  const statusLabels: Record<TodoStatus, string> = {
    pending: t('chat.todoPending', 'Pending'),
    in_progress: t('chat.todoInProgress', 'In progress'),
    completed: t('chat.todoCompleted', 'Completed'),
    cancelled: t('chat.todoCancelled', 'Cancelled'),
  }
  const priorityLabels: Record<TodoPriority, string> = {
    high: t('chat.todoPriorityHigh', 'High priority'),
    medium: t('chat.todoPriorityMedium', 'Medium priority'),
    low: t('chat.todoPriorityLow', 'Low priority'),
  }

  return (
    <div
      className={`yolo-todo-panel ${
        collapsed ? 'yolo-todo-panel--collapsed' : 'yolo-todo-panel--expanded'
      }`}
    >
      <div className="yolo-todo-panel__header">
        <button
          type="button"
          className="yolo-todo-panel__toggle"
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? t('chat.todoExpand', 'Expand todo list')
              : t('chat.todoCollapse', 'Collapse todo list')
          }
          onClick={() => setCollapsed((value) => !value)}
        >
          <ListTodo size={14} className="yolo-todo-panel__header-icon" />
          <span className="yolo-todo-panel__summary">
            {t('chat.todoTitle', 'Todos')} · {done}/{entries.length}
          </span>
          <ChevronDown size={12} className="yolo-todo-panel__caret" />
        </button>
      </div>
      <div className="yolo-todo-panel__body" aria-hidden={collapsed}>
        <div className="yolo-todo-panel__body-inner">
          <ul className="yolo-todo-panel__list">
            {entries.map((entry, index) => (
              <li
                key={`${entry.content}-${index}`}
                className={`yolo-todo-panel__item yolo-todo-panel__item--${entry.status}`}
              >
                {statusIcon(entry.status, statusLabels[entry.status])}
                <span className="yolo-todo-panel__text">{entry.content}</span>
                <span
                  className={`yolo-todo-panel__priority yolo-todo-panel__priority--${entry.priority}`}
                  aria-label={priorityLabels[entry.priority]}
                  title={priorityLabels[entry.priority]}
                >
                  <span aria-hidden="true" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default memo(TodoPanel)
