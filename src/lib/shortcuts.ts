const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent

export const shortcutModifier = /Mac|iPhone|iPad/.test(userAgent) ? '⌘' : 'Ctrl'
