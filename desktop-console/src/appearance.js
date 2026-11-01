// Only known CSS values cross the authenticated parent bridge, never CSS text.
const colors = ['bg', 'card', 'card-2', 'pill', 'pill-hover', 'ctl-fg', 'line', 'line-2', 'fg', 'fg-2', 'muted', 'accent', 'accent-soft', 'accent-fg', 'green', 'red', 'amber', 'pop-bg', 'c1', 'c2', 'c3', 'c4', 'c5']
const fonts = { font: 'font-family', code: 'font-family', weight: 'font-weight', style: 'font-style', stretch: 'font-stretch' }

export function applyAppearance(message) {
  const root = document.documentElement
  const tokens = message.tokens || {}
  for (const key of [...colors, ...Object.keys(fonts)]) {
    const value = tokens[key]
    if (typeof value !== 'string' || value.length > 512 || !CSS.supports(fonts[key] || 'color', value)) continue
    root.style.setProperty(`--native-${key}`, value)
  }
  root.dataset.motion = message.reducedMotion ? 'reduce' : 'auto'
  const theme = message.resolvedTheme === 'dark' ? 'dark' : 'light'
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  return theme
}
