/**
 * Copy to clipboard that actually works where this app runs.
 *
 * `navigator.clipboard` requires a secure context. https, localhost and
 * 127.0.0.1 qualify — a plain-http LAN or tailnet address does not, and that is
 * exactly how this app gets tested and often self-hosted. So the modern path is
 * tried first and a legacy path backs it up.
 *
 * Returns whether the copy genuinely happened; callers must not report success
 * on a false.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or unavailable — fall through to the legacy path.
  }

  return copyViaTextarea(text)
}

function copyViaTextarea(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  // Keep it out of view and out of the layout, but still selectable.
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)

  try {
    textarea.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
