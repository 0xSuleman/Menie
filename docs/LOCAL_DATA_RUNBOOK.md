# Local data runbook

This build keeps the meeting library on the device. It does not provide account-based sync, remote recovery, or encrypted-library storage.

## Backup

Open **Preferences** and choose **Create verified backup**. Menie checkpoints the SQLite library, copies it into the local backup directory, and runs SQLite `quick_check` on the copy before reporting success. Keep the resulting backup in a secure location you control.

## Restore

1. Quit Menie completely.
2. Preserve the current `meeting_minutes.sqlite` file in the application-data directory as a separate copy.
3. Replace it with a verified backup copy, retaining the filename `meeting_minutes.sqlite`.
4. Start Menie and review the Local runtime health report before recording.

Do not overwrite a library while Menie is running. If the restored library is older, meetings created after that backup will not be present.

## Retention and recovery

Meeting retention schedules move overdue meetings to **Trash**; they do not immediately erase local media, transcript, or artifacts. Restore a trashed meeting from the library when needed. Review retention schedules and Trash before reclaiming disk space outside Menie.

## Export and portability

Meeting details can export TXT, Markdown, VTT, SRT, JSON, and a versioned portable JSON bundle with checksums. Browser exports contain the selected local data; media files remain in the meeting's local recording folder unless copied separately.

## Record Only and deferred transcription

When **Record Only** is enabled, capture does not load an ASR model. After the local meeting record is saved, Menie creates an idempotent transcription job in the same SQLite library. The local processing worker claims that job on this or a later app start, retries transient failures, and leaves the source audio untouched if processing fails. Queue state is available through the native processing-jobs command; no audio or transcript content is sent to a service.

Preferences also shows queue counts and lets you cancel queued or retrying work. A job already running may finish its current local operation before the cancellation state is observed.

While recording, the flag control adds a short timestamped note without
interrupting capture. Notes remain in native recording state and are persisted
to the finalized meeting's local SQLite marker table after its meeting ID is
created.

The evidence panel can exclude one meeting or its entire project from local
knowledge retrieval. This is a reversible local setting: source meetings and
transcripts remain intact, and the local health report includes the excluded
meeting count.

## Support diagnostics

Preferences can assemble a local JSON diagnostic bundle. Review the exact payload before saving it. The bundle contains only privacy and runtime-health information; it excludes recordings, transcript text, meeting titles, prompts, and credentials. Menie never uploads the file.

## Security incident or suspected data loss

Stop recording if it is unsafe to continue, preserve the affected library and any verified backup, and follow the reporting guidance in [SECURITY.md](../SECURITY.md). Do not attach recordings or credentials unless you have reviewed and deliberately chosen to share them through a trusted channel.
