/**
 * Where the "buy me a coffee" link points.
 *
 * Deliberately a plain URL and not the Buy Me a Coffee embed: the official
 * widget is a third-party <script>, which would put an outbound request and a
 * tracker back on a page whose whole point (Phase 23) is that it makes none,
 * and whose privacy note says so (findings F25g).
 *
 * TODO: replace the empty string below with your page, e.g.
 *   export const BMC_URL = 'https://buymeacoffee.com/yourname'
 * While it is empty the footer renders no link at all, so a placeholder can
 * never ship as a dead one. To preview the layout without editing this file:
 *   VITE_BMC_URL=https://buymeacoffee.com/yourname npm run dev
 */
const CONFIGURED_URL = ''

/** Empty when no support link is configured. */
export function supportUrl(): string {
  const fromEnv = import.meta.env.VITE_BMC_URL
  const url = (typeof fromEnv === 'string' && fromEnv) || CONFIGURED_URL
  // Only ever an absolute https link — a relative or javascript: value here
  // would be an open redirect wearing a coffee cup.
  return url.startsWith('https://') ? url : ''
}

/**
 * Where the source lives. Unlike BMC_URL this is not optional and never empty:
 * the app says it is open source in the footer and in Help, and a claim like
 * that has to be checkable. A fork should repoint this at its own repository
 * rather than sending its users here.
 */
export const REPO_URL = 'https://github.com/mofane-work/pegboard'
