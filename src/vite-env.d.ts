/// <reference types="vite/client" />
/// <reference types="@react-three/fiber" />

interface ImportMetaEnv {
  /** Optional support link, so the footer can be previewed without editing source. */
  readonly VITE_BMC_URL?: string
  /**
   * Counter.dev site token, and the tracker's ONLY source — there is no
   * hardcoded fallback in lib/analytics.ts. Set by the Pages workflow from the
   * `COUNTER_DEV_ID` repository variable, which forks do not inherit; absent in
   * every local build and every fork, so `npm run dev` never counts a visit.
   */
  readonly VITE_COUNTER_DEV_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
