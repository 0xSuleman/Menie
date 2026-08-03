# MENIE Design System

## Product context
MENIE is a local-first desktop meeting workspace for recording conversations, producing live transcripts, and reviewing summaries, decisions, and next steps.

## Direction
Quiet command center: premium, focused, and calm. The interface prioritizes the next meeting action and the transcript itself over decorative marketing surfaces.

## Typography
- Display: Bricolage Grotesque (or the closest bundled expressive display face)
- Interface: Source Sans 3
- Body scale: 14px utility, 16px body, 20px section, 36–44px workspace headline

## Color
- Canvas: #F6F8FC
- Surface: #FFFFFF
- Ink: #101828
- Muted: #667085
- MENIE cobalt: #2457FF
- Genie cyan: #12B8C9
- Success: #0F9F75
- Warning: #B7791F
- Error: #D64545

Use the logo gradient only inside the logo. Primary actions are solid cobalt.

## Layout
- Fixed navigation rail: 248px expanded / 76px compact
- Workspace max width: 1180px
- Base spacing: 4px
- Radius: 6px controls, 10px panels, 16px major surfaces
- Prefer grid and whitespace over nested decorative cards

## Interaction
- One primary action per screen.
- Recording state is owned by RecordingStateContext and rendered as a contextual bottom dock.
- Tauri events remain the source of truth for recording and transcription lifecycle.
- Alerts are concise by default; detailed diagnostics open on demand.

## Anti-patterns
- No centered marketing card on the Home workspace.
- No purple gradient primary buttons.
- No permanent floating status badges over content.
- No repeated card grid for simple settings or product claims.
