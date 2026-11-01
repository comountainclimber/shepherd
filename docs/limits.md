[← Shepherd](../README.md) · [Documentation](README.md)

# Limits

- Shepherd pushes only for agent steps with **Push task branch before running** on. An agent creates the merge request; Shepherd keeps the link it reports. Shepherd does not resolve merge conflicts.
- Claude Code's models are a fixed list: Fable, Opus, Sonnet and Haiku. Drafting checklists always uses your Codex default.
- Saved steps belong to the configured data folder. A copy added to a project does not follow later changes to its saved step. A saved step whose model this machine does not offer gets your default model, and Shepherd says so.
