import deAnalytics from './de/analytics.json'
import deAudit from './de/audit.json'
import deAuth from './de/auth.json'
import deCommon from './de/common.json'
import deCompare from './de/compare.json'
import deExperiments from './de/experiments.json'
import deFlags from './de/flags.json'
import deLayout from './de/layout.json'
import dePlayground from './de/playground.json'
import deProjects from './de/projects.json'
import deSchedules from './de/schedules.json'
import deSegments from './de/segments.json'
import deSettings from './de/settings.json'
import enAnalytics from './en/analytics.json'
import enAudit from './en/audit.json'
import enAuth from './en/auth.json'
import enCommon from './en/common.json'
import enCompare from './en/compare.json'
import enExperiments from './en/experiments.json'
import enFlags from './en/flags.json'
import enLayout from './en/layout.json'
import enPlayground from './en/playground.json'
import enProjects from './en/projects.json'
import enSchedules from './en/schedules.json'
import enSegments from './en/segments.json'
import enSettings from './en/settings.json'

export const resources = {
  en: {
    common: enCommon,
    layout: enLayout,
    auth: enAuth,
    projects: enProjects,
    flags: enFlags,
    segments: enSegments,
    compare: enCompare,
    playground: enPlayground,
    audit: enAudit,
    experiments: enExperiments,
    schedules: enSchedules,
    settings: enSettings,
    analytics: enAnalytics,
  },
  de: {
    common: deCommon,
    layout: deLayout,
    auth: deAuth,
    projects: deProjects,
    flags: deFlags,
    segments: deSegments,
    compare: deCompare,
    playground: dePlayground,
    audit: deAudit,
    experiments: deExperiments,
    schedules: deSchedules,
    settings: deSettings,
    analytics: deAnalytics,
  },
} as const

export const namespaces = Object.keys(resources.en) as Array<keyof (typeof resources)['en']>
