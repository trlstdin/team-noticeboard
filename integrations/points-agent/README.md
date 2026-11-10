# Points advisory runner

This is the optional Node LangGraph runner for the existing noticeboard. The production Worker keeps the authoritative workflow checkpoints and all financial rules; this runner has no direct ledger node.

See [the full specification](../../POINTS.md) for setup, model configuration, graph recovery, permissions, and offline calibration.

Inject an existing member/supervisor session as `NOTICEBOARD_SESSION` through the environment. Never store it in this directory or pass it as a CLI argument. `--workflow ID` resumes a saved server workflow. New flows require `--type rules|signal|quality|appeal`, a `--prompt`, and (except rules) `--task ID`. Task signals and quality suggestions need editor access; rules need the root supervisor. Decisions remain manual in the board UI.

The default endpoint is the existing Site. `--url` allows only that host or localhost for testing. No hosting change, new Site, app secret, or long-running service is required.
