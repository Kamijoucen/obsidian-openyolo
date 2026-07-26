import {
  DEFAULT_SYSTEM_PROMPT_EN,
  DEFAULT_SYSTEM_PROMPT_ZH,
} from '../../core/acp/agentsMd'

import { normalizeSettings } from './setting.types'

describe('normalizeSettings system prompt language', () => {
  it('uses the current language for a fresh configuration', () => {
    expect(normalizeSettings(undefined, 'en')).toMatchObject({
      systemPrompt: DEFAULT_SYSTEM_PROMPT_EN,
    })
    expect(normalizeSettings(undefined, 'zh')).toMatchObject({
      systemPrompt: DEFAULT_SYSTEM_PROMPT_ZH,
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
})
