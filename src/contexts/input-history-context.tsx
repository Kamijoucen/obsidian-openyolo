import { createContext, useContext } from 'react'

import type { InputHistory } from '../core/inputHistory'

const InputHistoryContext = createContext<InputHistory | null>(null)

export const InputHistoryProvider = InputHistoryContext.Provider

export function useInputHistory(): InputHistory {
  const history = useContext(InputHistoryContext)
  if (!history) {
    throw new Error('useInputHistory must be used within InputHistoryProvider')
  }
  return history
}
