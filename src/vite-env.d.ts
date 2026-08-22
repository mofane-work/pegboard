/// <reference types="vite/client" />
/// <reference types="@react-three/fiber" />

interface ImportMetaEnv {
  /** Optional support link, so the footer can be previewed without editing source. */
  readonly VITE_BMC_URL?: string
  /**
   * Counter.dev site token. Empty or absent in every local build — the tracker
   * is injected only when this (or CONFIGURED_ID in lib/analytics.ts) is set,
   * so `npm run dev` never counts a visit. Set by the Pages workflow.
   */
  readonly VITE_COUNTER_DEV_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
