# Agent Skills for WebDAW

This document defines the skills available to the agent when working on the WebDAW project. These skills guide how the agent should approach tasks, make decisions, and interact with the codebase.

## Core Development Skills

### create_code
**Purpose**: Create new code files, components, or modules for the WebDAW application.

**When to use**: 
- Adding new React components
- Creating new utility modules
- Adding new TypeScript type definitions
- Implementing new features or functionality

**How to use**:
1. Analyze existing code patterns in the repository
2. Follow the established naming conventions (PascalCase for components, camelCase for variables/functions)
3. Match the coding style (indentation, formatting, etc.)
4. Include proper TypeScript types
5. Add relevant imports and exports
6. Consider the Web Audio API context where applicable

**Example patterns from codebase**:
- React components use functional components with hooks
- Zustand is used for state management (see trackStore.ts)
- TypeScript interfaces are defined for complex types (Track, Clip, etc.)
- Audio processing uses Web Audio API types

**Constraints**:
- Always read at least one similar existing file before creating new code
- Match the project's TypeScript strictness level
- Follow the existing folder structure and organization

---

### read_code
**Purpose**: Read, understand, and analyze existing code in the repository.

**When to use**:
- Before modifying any file
- When debugging issues
- When understanding how features work
- When planning new implementations

**How to use**:
1. Read the entire file end-to-end for context
2. Identify the main exports and their purposes
3. Understand the data flow and dependencies
4. Note any patterns or conventions used
5. Identify related files that might need to be read as well

**Key files to understand in WebDAW**:
- `src/store/trackStore.ts` - Central state management for tracks and clips
- `src/types/daw.ts` - Type definitions for the DAW
- Audio effect files in `src/audio/` - Audio processing logic

**Constraints**:
- Never edit a file in the same turn you first read it
- Read files that call your target and files called by your target
- Check for AGENTS.md files in the directory hierarchy

---

### modify_code
**Purpose**: Edit existing code files to fix bugs, add features, or improve functionality.

**When to use**:
- Fixing bugs in existing components
- Adding new properties or methods to existing modules
- Refactoring existing code
- Updating dependencies or APIs

**How to use**:
1. First read the file to understand its current state
2. Identify the exact location where changes are needed
3. Make minimal, focused changes
4. Preserve existing functionality
5. Update any related type definitions
6. Consider backward compatibility

**Best practices for WebDAW**:
- When modifying trackStore.ts, consider the undo/redo stack implications
- Audio processing changes may need to handle Web Audio API constraints
- UI changes should maintain the existing design system

**Constraints**:
- Match existing style (indentation, naming, error handling)
- Minimal diff - remove completely when removing
- Update all call sites when changing function signatures
- Test the changes after modification

---

### test_code
**Purpose**: Verify that code changes work correctly and don't break existing functionality.

**When to use**:
- After creating new code
- After modifying existing code
- Before committing changes
- When debugging issues

**How to use**:
1. Run the existing test suite if available
2. Manually test the changed functionality in the browser
3. Verify that related features still work
4. Check for TypeScript compilation errors
5. Test edge cases and error conditions

**WebDAW testing considerations**:
- Test audio processing with different buffer sizes and sample rates
- Test UI interactions across different screen sizes
- Verify state management works correctly with undo/redo
- Test with different audio file formats

**Constraints**:
- Don't claim "verified" or "tested" unless you've actually run the tests
- If verification was skipped, state it explicitly

---

### debug_code
**Purpose**: Identify and fix issues in the codebase.

**When to use**:
- When users report bugs
- When tests are failing
- When functionality doesn't work as expected
- When performance issues arise

**How to use**:
1. Reproduce the issue consistently
2. Add debug logging or use browser dev tools
3. Analyze the call stack and data flow
4. Identify the root cause
5. Implement a minimal fix
6. Verify the fix resolves the issue

**WebDAW-specific debugging**:
- Audio issues: Check Web Audio API error handling
- UI issues: Use React DevTools and browser inspector
- State issues: Log Zustand store state changes
- Performance: Profile audio processing and rendering

**Constraints**:
- Stop after three failed attempts and change strategy
- Don't alternate between two failing approaches
- Ask for clarification if the issue is unclear

---

### analyze_architecture
**Purpose**: Understand the overall structure and design patterns of the WebDAW application.

**When to use**:
- When planning major new features
- When refactoring significant portions of the codebase
- When onboarding new team members
- When making architectural decisions

**How to use**:
1. Map the main components and their relationships
2. Identify the data flow patterns
3. Understand the state management approach
4. Document key architectural decisions
5. Identify potential improvement areas

**WebDAW architecture overview**:
- Frontend: React with TypeScript
- State Management: Zustand
- Audio Engine: Web Audio API
- File Structure: Feature-based organization
- Key Domains: Tracks, Clips, Audio Effects, Transport

**Constraints**:
- Consider the impact on existing code before suggesting changes
- Respect the existing architectural patterns

---

### refactor_code
**Purpose**: Improve existing code without changing its external behavior.

**When to use**:
- When code is hard to understand or maintain
- When there's significant duplication
- When performance improvements are needed
- When preparing for new features that require cleaner code

**How to use**:
1. Ensure the existing behavior is well-understood
2. Identify the specific improvements needed
3. Make small, incremental changes
4. Verify that behavior remains the same
5. Update any affected tests or documentation

**WebDAW refactoring priorities**:
- Reduce duplication in track and clip handling
- Improve type safety for audio processing
- Optimize performance-critical audio code
- Improve separation of concerns between UI and audio logic

**Constraints**:
- Don't refactor and add features in the same change
- Preserve all existing functionality
- Maintain backward compatibility

---

## Domain-Specific Skills

### audio_processing
**Purpose**: Work with Web Audio API and audio processing logic.

**When to use**:
- Implementing new audio effects
- Modifying existing audio processing
- Debugging audio-related issues
- Optimizing audio performance

**How to use**:
1. Understand the Web Audio API fundamentals
2. Follow the existing patterns in `src/audio/`
3. Consider real-time processing constraints
4. Handle edge cases (empty buffers, invalid values)
5. Test with various audio formats and sample rates

**Key considerations**:
- Audio processing must be efficient to avoid glitches
- All audio parameters should have sensible defaults
- Error handling should be robust but not disruptive

---

### ui_implementation
**Purpose**: Create and modify user interface components.

**When to use**:
- Adding new UI elements
- Modifying existing components
- Improving user experience
- Fixing UI bugs

**How to use**:
1. Follow the existing component patterns
2. Use appropriate React hooks for state and effects
3. Maintain accessibility standards
4. Ensure responsive design
5. Match the existing visual design system

**WebDAW UI patterns**:
- Track-based UI with clips
- Transport controls
- Audio effect panels
- Modal dialogs for user input

---

### state_management
**Purpose**: Work with Zustand stores and application state.

**When to use**:
- Adding new state properties
- Modifying existing store logic
- Debugging state-related issues
- Optimizing state updates

**How to use**:
1. Understand the current store structure
2. Follow the existing patterns for actions and getters
3. Consider the impact on performance and re-renders
4. Maintain immutability where appropriate
5. Handle undo/redo where applicable (as in trackStore.ts)

**Key patterns in WebDAW**:
- Undo stack for destructive operations (split, trim, cut, paste, delete)
- Selected track/clip management
- Active track concept
- Clipboard for copy/paste operations

---

## Workflow Skills

### plan_implementation
**Purpose**: Create a structured plan for implementing new features or fixing complex issues.

**When to use**:
- When the task is multi-step or complex
- When multiple files need to be modified
- When architectural decisions are needed
- When coordinating with other developers

**How to use**:
1. Break down the task into discrete steps
2. Identify dependencies between steps
3. Estimate complexity and time for each step
4. Identify potential risks or challenges
5. Create a clear, actionable plan

---

### code_review
**Purpose**: Review code changes for quality, correctness, and adherence to standards.

**When to use**:
- Before committing changes
- When reviewing pull requests
- When assessing code quality
- When mentoring other developers

**How to use**:
1. Check that the code compiles without errors
2. Verify that the implementation matches requirements
3. Assess code quality and readability
4. Check for potential bugs or edge cases
5. Verify that tests pass and coverage is adequate

---

## Quality Assurance Skills

### write_tests
**Purpose**: Create automated tests for code functionality.

**When to use**:
- When adding new features
- When fixing bugs
- When refactoring code
- To improve test coverage

**How to use**:
1. Identify the functionality to test
2. Write tests for happy paths and edge cases
3. Follow existing test patterns in the codebase
4. Ensure tests are deterministic and reliable
5. Aim for good coverage of critical functionality

---

### performance_optimization
**Purpose**: Improve the performance of the application.

**When to use**:
- When users report performance issues
- When profiling shows bottlenecks
- When adding performance-critical features
- During regular maintenance

**How to use**:
1. Identify the performance bottleneck
2. Profile the current behavior
3. Implement targeted optimizations
4. Verify that performance has improved
5. Ensure that functionality remains correct

**WebDAW performance considerations**:
- Audio processing must happen in real-time
- UI updates should not block the audio thread
- Large projects with many tracks and clips need to be efficient

---

## Project-Specific Knowledge

### track_clip_management
**Domain**: Track and clip handling in the DAW

**Key files**:
- `src/store/trackStore.ts` - Core track and clip state management
- `src/types/daw.ts` - Type definitions for Track and Clip

**Key concepts**:
- Tracks contain clips with audio data
- Clips have start positions (in beats) and durations
- Selected tracks and clips for batch operations
- Undo stack for destructive operations
- Active track concept for user interaction

**Common operations**:
- Adding/removing tracks and clips
- Moving clips between tracks
- Splitting and trimming clips
- Copy/paste operations
- Quantization of clip positions

---

### audio_effects
**Domain**: Audio effects processing in the DAW

**Key files**:
- `src/audio/compressor.ts` - Compressor effect
- `src/audio/gate.ts` - Gate effect
- `src/audio/eq.ts` - Equalizer effect
- `src/audio/reverb.ts` - Reverb effect
- `src/audio/delay.ts` - Delay effect

**Key concepts**:
- Each track has its own set of effects
- Effects have default settings
- Effects can be bypassed or enabled
- Parameters can be adjusted in real-time

---

### transport_controls
**Domain**: Playback and recording controls

**Key concepts**:
- Playhead position in beats
- Playback state (playing, stopped, recording)
- BPM (beats per minute) for timing
- Loop regions
- Quantization grid

---

## Best Practices

### Code Quality
1. **Type Safety**: Use TypeScript types effectively
2. **Immutability**: Prefer immutable updates, especially in state management
3. **Error Handling**: Handle edge cases gracefully
4. **Performance**: Consider performance implications, especially for audio processing
5. **Readability**: Write clear, self-documenting code

### WebDAW-Specific
1. **Audio Thread**: Don't block the audio processing thread
2. **State Consistency**: Maintain consistency in Zustand stores
3. **Undo Support**: Add undo support for destructive operations
4. **User Experience**: Consider the musical workflow and user expectations
5. **Browser Compatibility**: Test across supported browsers

### Testing
1. **Unit Tests**: Test individual functions and components
2. **Integration Tests**: Test interactions between components
3. **End-to-End Tests**: Test complete user workflows
4. **Edge Cases**: Test with unusual or extreme inputs

---

## Skill Usage Guidelines

- **Priority Order**: Use the most specific skill that applies to the current task
- **Combination**: Multiple skills can be used together for complex tasks
- **Fallback**: If no specific skill applies, use general development skills
- **Documentation**: Update this file when new patterns or skills emerge

This skills document helps ensure consistent, high-quality development across the WebDAW project.