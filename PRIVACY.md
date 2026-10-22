# Privacy

Classmate Lilith runs its workspace service on `127.0.0.1`. File transcription sends normalized audio chunks, and realtime transcription sends a microphone audio stream, to the online provider selected by the user. Proofreading and written-prose operations send the selected text to the configured text provider.

On Windows, the installed edition stores data under the system Documents folder in `Classmate Lilith/data`, with logs in the sibling `logs` directory; the portable edition uses its application directory. On macOS, mutable data is stored under `~/Library/Application Support/Classmate Lilith` and logs under `~/Library/Logs/Classmate Lilith`; the `.app` bundle remains read-only. Explicit data/log directory overrides still apply. Credentials use lightweight reversible encryption for portability and must not be treated as an operating-system key vault. Never share or publish a used data directory without creating a clean release package.

Version 0.23.1 stores recoverable live-recording fragments and transcript checkpoints under `data/live-recordings`. Recovery points and soft-deleted projects under `data/trash` are retained locally without automatic expiry. A saved recording may also have recovery fragments and assembled copies remaining on disk; removal from the active project list is not permanent erasure. Recovering a recording does not automatically send it to an online provider. These additions are not present in v0.22.2 or older packages.

The application does not include or download local speech-recognition models. FFmpeg processing happens on the user's computer before online upload. Runtime logs do not intentionally record API keys or complete request bodies.
