{{/* Chart name */}}
{{- define "halyard.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Fully qualified app name */}}
{{- define "halyard.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "halyard.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "halyard.labels" -}}
helm.sh/chart: {{ include "halyard.chart" . }}
{{ include "halyard.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "halyard.selectorLabels" -}}
app.kubernetes.io/name: {{ include "halyard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "halyard.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "halyard.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "halyard.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{/* Name of the Secret the Deployment reads (user-provided or chart-managed). */}}
{{- define "halyard.secretName" -}}
{{- default (include "halyard.fullname" .) .Values.existingSecret }}
{{- end }}

{{/* Whether the chart renders its own Secret. */}}
{{- define "halyard.createSecret" -}}
{{- if not .Values.existingSecret }}true{{- end }}
{{- end }}

{{/* Whether /metrics is protected by a token the ServiceMonitor can read. */}}
{{- define "halyard.metricsHasToken" -}}
{{- if or .Values.metrics.token (and .Values.existingSecret .Values.metrics.existingSecretHasToken) }}true{{- end }}
{{- end }}

{{/* Public URL for better-auth. */}}
{{- define "halyard.authUrl" -}}
{{- if .Values.auth.url }}
{{- .Values.auth.url }}
{{- else if and .Values.ingress.enabled .Values.ingress.hosts }}
{{- $scheme := ternary "https" "http" (not (empty .Values.ingress.tls)) }}
{{- printf "%s://%s" $scheme (index .Values.ingress.hosts 0).host }}
{{- end }}
{{- end }}

{{/*
envFrom + DATABASE_URL override shared by the Deployment and the migration Job.
Call with a dict: root = $, secretName = <Secret to envFrom>.
*/}}
{{- define "halyard.secretRefs" -}}
envFrom:
  - secretRef:
      name: {{ .secretName }}
  {{- with .root.Values.extraEnvFrom }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
{{- end }}

{{- define "halyard.databaseUrlEnv" -}}
{{- with .Values.database.existingSecret }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ $.Values.database.existingSecretKey | default "DATABASE_URL" }}
{{- end }}
{{- end }}
