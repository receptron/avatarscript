# AvatarScript

Turn an avatar and text into a lip-synced, acted video:

```
avatar package + text ──► LLM ──► AvatarScript (.avs) ──► compiler ──► TTS ──► score.json ──► video.mp4
```

AvatarScript defines a standard avatar package, a script language for directing an avatar's
speech, emotion and gestures, and a compiler and renderer that produce the video. The first
runtime is the mesh avatar engine from
[mesh-avatar-studio](https://github.com/shinshin86/mesh-avatar-studio).

The project is in the planning stage. See [PLAN.md](PLAN.md) for the design and milestones.

## License

[MIT](LICENSE)
