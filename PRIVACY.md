# Privacy

Classmate Lilith runs its workspace service on `127.0.0.1`. Transcription sends normalized audio chunks only to the online provider selected by the user. Proofreading and written-prose operations send the selected text to the configured text provider.

On Windows, API credentials, recordings, tasks, recovery responses, and runtime logs are stored under the portable application directory. On macOS, mutable data is stored under `~/Library/Application Support/Classmate Lilith` and logs under `~/Library/Logs/Classmate Lilith`; the `.app` bundle remains read-only. Credentials use lightweight reversible encryption for portability and must not be treated as an operating-system key vault. Never share or publish a used data directory without creating a clean release package.

The application does not include or download local speech-recognition models. FFmpeg processing happens on the user's computer before online upload. Runtime logs do not intentionally record API keys or complete request bodies.
