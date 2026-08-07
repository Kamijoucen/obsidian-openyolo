import { Check, Paperclip, Plus } from 'lucide-react'
import { TFile } from 'obsidian'
import { useEffect, useMemo, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { useLanguage } from '../../contexts/language-context'

import {
  MAX_NOTE_PICKER_RESULTS,
  filterAndSortNoteFiles,
} from './notePickerSearch'
import { SelectPopover, usePopover } from './selects'

export type AttachedNote = {
  path: string
  name: string
  /** true 表示 path 为库外绝对路径，false/缺省为库内相对路径 */
  absolute?: boolean
}

export function NotePicker({
  selected,
  disabled,
  onToggle,
  onPickFile,
}: {
  selected: Set<string>
  disabled?: boolean
  onToggle: (file: TFile) => void
  onPickFile: () => void
}) {
  const app = useApp()
  const { t } = useLanguage()
  const { open, setOpen, containerRef } = usePopover()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const files = useMemo(
    () => (open ? app.vault.getMarkdownFiles() : []),
    [app, open],
  )
  const visible = useMemo(
    () => filterAndSortNoteFiles(files, query),
    [files, query],
  )

  return (
    <div className="yolo-acp-select" ref={containerRef}>
      <button
        type="button"
        className="yolo-chat-user-input-submit-button yolo-chat-user-input-upload-button"
        title={t('chat.attach', 'Add attachment')}
        data-state={open ? 'open' : 'closed'}
        aria-label={t('chat.attach', 'Add attachment')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Plus size={14} />
      </button>
      <SelectPopover open={open} anchorRef={containerRef} align="left">
        <div className="yolo-acp-attach-actions">
          <button
            type="button"
            className="yolo-popover-item"
            onClick={() => {
              setOpen(false)
              onPickFile()
            }}
          >
            <span className="yolo-acp-attach-actions__icon">
              <Paperclip size={14} />
            </span>
            <span className="yolo-popover-item__label">
              {t('chat.attachFile', 'Attach file')}
            </span>
          </button>
        </div>
        <div className="yolo-acp-select-search">
          <input
            type="text"
            autoFocus
            placeholder={t('chat.searchNotes', 'Search notes…')}
            aria-label={t('chat.searchNotes', 'Search notes…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="yolo-model-select-list" role="menu">
          {visible.files.map((file) => {
            const parent = file.parent?.path
            return (
              <button
                key={file.path}
                type="button"
                role="menuitemcheckbox"
                aria-checked={selected.has(file.path)}
                data-state={selected.has(file.path) ? 'checked' : 'unchecked'}
                className="yolo-popover-item yolo-acp-command-item"
                onClick={() => onToggle(file)}
              >
                <span className="yolo-acp-command-item__content">
                  <span className="yolo-acp-command-item__label">
                    {file.basename}
                  </span>
                  {parent && parent !== '/' ? (
                    <span className="yolo-acp-command-desc">{parent}</span>
                  ) : null}
                </span>
                <span className="yolo-popover-item__indicator">
                  {selected.has(file.path) ? <Check size={12} /> : null}
                </span>
              </button>
            )
          })}
        </div>
        {visible.total > visible.files.length ? (
          <div className="yolo-acp-note-results-limited" role="status">
            {t(
              'chat.noteResultsLimited',
              `Showing the first ${MAX_NOTE_PICKER_RESULTS} matching notes.`,
            )}
          </div>
        ) : null}
      </SelectPopover>
    </div>
  )
}
