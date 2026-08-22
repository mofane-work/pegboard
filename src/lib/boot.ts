/**
 * Dismisses the pre-React splash that index.html paints.
 *
 * The splash is inline HTML in the document because nothing renders until the
 * bundle, i18n and the store rehydration have resolved — React cannot draw its
 * own loading state before React exists (findings F25f). So React does not own
 * the splash; it only takes it away.
 *
 * Idempotent, because StrictMode runs mount effects twice in development.
 */

/** Matches the `transition: opacity` duration in index.html. */
export const BOOT_FADE_MS = 200

export function dismissBoot(): void {
  const node = document.getElementById('boot')
  // Already dismissed, or never there at all — jsdom tests mount App into a
  // bare container. Absence is a normal state, not a failure.
  if (!node) return
  if (node.dataset.done) return

  node.dataset.done = 'true'

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    node.remove()
    return
  }

  // transitionend fires on the fade; the timeout is the backstop for a browser
  // that skips the transition (background tab, forced-reduced-motion at the OS
  // level). Whichever lands first wins — remove() is safe to call once.
  const remove = () => node.remove()
  node.addEventListener('transitionend', remove, { once: true })
  window.setTimeout(remove, BOOT_FADE_MS + 50)
}
