export type PlatformUpdateManifest = {
  version: string
  path: string
  sha512: string | null
  releaseDate: string | null
}

export type PlatformUpdateLatestResponse = PlatformUpdateManifest | { empty: true }

export type PlatformUpdateHealthResponse = {
  ok: true
  updatesDir: string
  directoryExists: boolean
  latestYmlExists: boolean
}

export type PlatformUpdateFileEntry = {
  name: string
  sizeBytes: number
  modifiedAtMs: number
}

export type PlatformUpdateFilesResponse = {
  updatesDir: string
  directoryExists: boolean
  files: PlatformUpdateFileEntry[]
}

export type PlatformUpdateUploadAccepted = {
  name: string
  sizeBytes: number
  sha512Base64: string
}

export type PlatformUpdateUploadRejected = {
  name: string
  reason: string
}

export type PlatformUpdateUploadResponse = {
  accepted: PlatformUpdateUploadAccepted[]
  rejected: PlatformUpdateUploadRejected[]
  files: PlatformUpdateFileEntry[]
}

export type PlatformUpdatePublishResponse = {
  version: string
  installer: string
  sha512: string
  sizeBytes: number
  releaseDate: string
  files: PlatformUpdateFileEntry[]
}
