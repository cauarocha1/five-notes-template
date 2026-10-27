/** Removes stored data from the retired canvas while preserving note text. */
export function stripRetiredCanvasContent(markdown: string) {
  const cleaned = markdown
    .replace(/<!--five-system-design:v1:[\s\S]*?-->/g, '')
    .replace(/<!--(?:!--)?five-canvas-block-->/g, '')
    .replace(/(^|\n)```five-canvas[ \t]*\r?\n[\s\S]*?```[ \t]*(?=\n|$)/g, '$1')
  if (cleaned === markdown) return markdown
  return cleaned.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd()
}
