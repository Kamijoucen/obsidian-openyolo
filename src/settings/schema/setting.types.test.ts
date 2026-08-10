import {
  DEFAULT_SYSTEM_PROMPT_EN,
  DEFAULT_SYSTEM_PROMPT_ZH,
} from '../../core/acp/agentsMd'
import { DEFAULT_CHAT_LOG_FOLDER } from '../../core/chatLog'

import { normalizeSettings } from './setting.types'

describe('normalizeSettings system prompt language', () => {
  it('uses the current language for a fresh configuration', () => {
    expect(normalizeSettings(undefined, 'en')).toMatchObject({
      attachCurrentNote: true,
      manageAgentsMd: false,
      systemPrompt: DEFAULT_SYSTEM_PROMPT_EN,
    })
    expect(normalizeSettings(undefined, 'zh')).toMatchObject({
      manageAgentsMd: false,
      systemPrompt: DEFAULT_SYSTEM_PROMPT_ZH,
    })
  })

  it('normalizes the current-note attachment preference', () => {
    expect(normalizeSettings({ attachCurrentNote: false })).toMatchObject({
      attachCurrentNote: false,
    })
    expect(normalizeSettings({ attachCurrentNote: 'invalid' })).toMatchObject({
      attachCurrentNote: true,
    })
  })

  it('keeps AGENTS.md management opt-in while preserving an existing choice', () => {
    expect(normalizeSettings({ manageAgentsMd: true }, 'en')).toMatchObject({
      manageAgentsMd: true,
    })
    expect(normalizeSettings({ manageAgentsMd: false }, 'en')).toMatchObject({
      manageAgentsMd: false,
    })
  })

  it('preserves an existing prompt without language migration', () => {
    expect(
      normalizeSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT_ZH }, 'en'),
    ).toMatchObject({
      systemPrompt: DEFAULT_SYSTEM_PROMPT_ZH,
    })
    expect(
      normalizeSettings({ systemPrompt: 'My custom vault rules' }, 'zh'),
    ).toMatchObject({
      systemPrompt: 'My custom vault rules',
    })
  })

  it('uses the localized default for an empty prompt', () => {
    expect(normalizeSettings({ systemPrompt: '  ' }, 'en')).toMatchObject({
      systemPrompt: DEFAULT_SYSTEM_PROMPT_EN,
    })
  })

  it('normalizes the conversation log folder', () => {
    expect(normalizeSettings(undefined)).toMatchObject({
      conversationLogFolder: DEFAULT_CHAT_LOG_FOLDER,
    })
    expect(normalizeSettings({ conversationLogFolder: '  ' })).toMatchObject({
      conversationLogFolder: DEFAULT_CHAT_LOG_FOLDER,
    })
    expect(normalizeSettings({ conversationLogFolder: 42 })).toMatchObject({
      conversationLogFolder: DEFAULT_CHAT_LOG_FOLDER,
    })
    expect(
      normalizeSettings({ conversationLogFolder: 'AI/history' }),
    ).toMatchObject({ conversationLogFolder: 'AI/history' })
  })
})
