import { afterEach, describe, expect, it } from 'vitest'
import { LANGS, dateLocale, getLang, setLang, t, toggleLang } from './i18n'

afterEach(() => setLang('en'))

describe('localization', () => {
  it('starts in English and exposes the supported languages', () => {
    expect(getLang()).toBe('en')
    expect(LANGS).toEqual([{ code: 'en', label: 'English' }, { code: 'nl', label: 'Nederlands' }])
    expect(t('from')).toBe('From')
    expect(dateLocale()).toBe('en-GB')
  })

  it('uses the Dutch date locale and falls back to English for untranslated text', () => {
    setLang('nl')
    expect(getLang()).toBe('nl')
    expect(dateLocale()).toBe('nl-NL')
    expect(t('loadingTimes')).toBe('Loading times...')
  })

  it('toggles in both directions', () => {
    expect(toggleLang()).toBe('nl')
    expect(toggleLang()).toBe('en')
  })
})
