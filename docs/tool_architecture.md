# Unity Agent Automation Architecture

## Goal

Build a reliable automation layer for Unity that works well with LLM agents, especially Claude, without making the agent reason about Unity editor lifecycle details such as asset refresh, compilation, or domain reload.

The architecture should separate:

* what makes sense for the agent-facing interface
* what makes sense for Unity execution
* what internal metadata is needed for reliability

The main design principle is:

**Claude should call a simple, stable CLI or tool surface. The CLI/adapter should translate those calls into a richer internal command model that Unity can execute safely.**

---

## Core Problem

Unity automation is not only a matter of issuing commands. Many operations depend on editor state.

Example failure case:

1. A task creates a new component script.
2. The next step tries to add that component to a prefab.
3. Unity has not finished refresh/compilation/domain reload.
4. The type does not exist yet from Unity's point of view.
5. The command fails even though the overall task is logically correct.

This means the system must not treat all commands as immediately executable.

---

## Design Goals

### Reliability

* Commands should not fail merely because Unity is temporarily out of date.
* Commands that depend on compilation should wait until Unity is ready.
* Compiler errors should not automatically clear the queue.

### Agent usability

* Claude should interact with a small, predictable tool surface.
* The agent should not be responsible for low-level Unity lifecycle orchestration.
* The agent should not need to manually issue refresh/compile commands in normal use.

### Separation of concerns

* The CLI/tool surface should be designed for agent clarity.
* The internal Unity command model should be designed for correctness and observability.
* Unity-specific waiting, retries, and state transitions should stay internal.

### Observability

* The system should expose queue state, waiting reasons, compile status, and results.
* It should be easy to see what command is blocked, why it is blocked, and what resolved or failed.

### Extensibility

* The same internal model should support editor operations now and play mode / runtime operations later.
* MCP compatibility can be added later without changing the core runtime architecture.

---

## High-Level Architecture

```text
Claude
  ↓
Agent-facing CLI / tool layer
  ↓
Local daemon / orchestration layer
  ↓
Internal command queue + scheduler
  ↓
Unity Editor bridge
  ↓
Unity Editor / Play Mode / Project Assets
```

### Layer responsibilities

#### 1. Claude

Responsible for intent, sequencing, and tool usage.

Claude should operate at the level of actions such as:

* find prefab
* inspect prefab
* create script
* add component
* set property
* get queue status
* check compile status

Claude should not need to reason deeply about:

* whether AssetDatabase.Refresh is needed
* whether compilation is currently valid
* whether the domain has reloaded yet
* whether a command should be retried automatically

#### 2. Agent-facing CLI / tool layer

This is the main interface exposed to Claude.

It should be:

* simple
* explicit
* validated
* stable over time

This layer should optimize for what is easy and safe for the model to call.

It should not expose unnecessary Unity internals unless required for debugging.

Examples:

* `unity find-prefabs`
* `unity inspect-prefab`
* `unity create-script`
* `unity add-component`
* `unity set-property`
* `unity get-queue`
* `unity get-compile-status`
* `unity get-console`

This layer translates user/agent-friendly arguments into internal commands.

#### 3. Local daemon / orchestration layer

A persistent local process that:

* receives CLI/tool requests
* validates arguments
* creates internal commands
* persists queue state
* tracks command status
* communicates with Unity
* survives longer than Unity domain reloads
* optionally auto-starts when commands are issued

This daemon should be the operational anchor of the system.

#### 4. Internal command queue + scheduler

This is the core reliability layer.

It decides:

* whether a command is ready to run
* what it is waiting for
* whether it should retry
* whether it should remain blocked
* whether a failed compile should pause rather than discard commands

This scheduler is where Unity lifecycle awareness belongs.

#### 5. Unity Editor bridge

A Unity-side C# package or editor integration responsible for:

* executing safe editor operations
* interacting with scenes, prefabs, assets, and components
* resolving types via reflection
* applying serialized field changes
* reporting compile and reload state
* providing queue-relevant telemetry back to the daemon

This bridge should be thin and state-aware.

---

## Key Architectural Principle

### Public interface and internal protocol should be different

The agent-facing interface should not be the same as the internal Unity command schema.

Why:

* Claude needs clarity and narrow choices.
* Unity needs richer metadata, policies, and waiting conditions.
* Internal schemas will evolve more often than the public CLI.
* Reliability features such as timestamps, retries, queue state, and waiting reasons should be managed internally.

Therefore:

* **Claude calls CLI commands or structured tools.**
* **The CLI/tool layer converts those calls into internal queue commands.**
* **Unity executes only the internal commands.**

---

## Command Model

### Public command shape

The public CLI/tool shape should be minimal and action-oriented.

Examples:

* find assets
* resolve one asset
* inspect an object
* mutate a prefab
* create a script
* query queue state

The public command should include only the fields needed for the action.

### Internal command shape

The internal command should contain richer metadata.

Suggested required fields:

* `id`
* `originTaskId`
* `kind`
* `args`
* `createdAt`
* `policy`

Suggested optional fields:

* `requirements`
* `dependsOn`
* `priority`
* `timeoutMs`
* `humanLabel`

### Why this split matters

The internal command schema must support:

* reliable queue persistence
* waiting and retry behavior
* task grouping
* dependency tracking
* state reporting
* auditability

Claude does not need to author all of that directly.

---

## Asset Resolution Strategy

### Do not use ambiguous search inside mutation commands

Mutation commands should not take regex or fuzzy search inputs when targeting important assets such as prefabs.

That creates a risk of selecting the wrong asset.

### Use a two-step pattern

#### Step 1: Search or resolve

Use read-only commands to find or resolve assets.

Examples:

* `find-prefabs`
* `resolve-asset`
* `inspect-prefab`

These can support:

* exact name
* exact path
* GUID
* restricted regex
* folder-scoped search

#### Step 2: Mutate by resolved identity

Once the agent has selected the correct asset, mutation commands should use a stable identifier.

Preferred order:

1. GUID
2. path with verification
3. both GUID and path for safety

This gives the agent flexibility during discovery and safety during mutation.

---

## Refresh and Compilation Strategy

### Asset refresh should usually be internal

The system should not normally expose `asset_refresh` as a required public command.

Instead, the scheduler should infer refresh when needed.

Examples where refresh may be required internally:

* files were written directly to disk under `Assets/`
* files were written directly to disk under `Packages/`
* code files changed outside Unity APIs

### Compilation should be treated as a dependency state

Commands that depend on newly added types should not run until:

* relevant assets are refreshed/imported
* compilation succeeds
* domain reload completes
* type resolution succeeds

The agent should not be responsible for orchestrating this sequence manually.

### Commands should express requirements, not lifecycle steps

Good internal requirement examples:

* needs successful compilation
* requires specific type(s)
* requires play mode
* requires specific asset(s)

The scheduler translates these requirements into lifecycle actions.

---

## Queue and State Model

### Why the queue matters

A queue is not only a transport buffer. It is the system's memory of:

* what has been requested
* what has already run
* what is waiting
* why it is waiting
* what failed
* what should retry later

### Suggested command states

* `queued`
* `waiting`
* `running`
* `succeeded`
* `failed`
* `blocked`
* `cancelled`

### Suggested waiting reasons

* `awaiting_asset_refresh`
* `awaiting_compilation`
* `awaiting_domain_reload`
* `awaiting_type_resolution`
* `awaiting_dependency_command`
* `awaiting_play_mode`
* `awaiting_user_fix_compile_errors`

### Suggested visible status fields

* `id`
* `state`
* `waitingReason`
* `attemptCount`
* `lastError`
* `updatedAt`
* `originTaskId`

This should be queryable from the CLI.

---

## Compiler Error Policy

### Compiler errors should not clear the queue

If a command is waiting on a compiled type and compilation currently fails, the command should generally remain in the queue.

Default behavior:

* keep the command in `waiting`
* record current compiler diagnostics snapshot
* retry after the next successful compile cycle

### When to move from waiting to blocked

A command should move to `blocked` when its dependency becomes meaningfully impossible under the current task state.

Examples:

* the upstream command that was supposed to create the script has definitively failed
* the expected type does not exist after repeated valid compile cycles
* the targeted asset no longer exists and cannot be resolved

Blocked commands should remain visible rather than being silently removed.

---

## Daemon Lifecycle

### Auto-start behavior

The daemon should start automatically when commands are issued, rather than requiring manual startup.

Recommended behavior:

* agent or CLI issues a command
* wrapper checks whether daemon is running
* if not, wrapper starts the daemon
* wrapper waits for a ready signal
* command is submitted

### Why the daemon should be persistent

A persistent daemon is useful because it:

* holds queue state
* survives Unity domain reloads
* can reconnect to Unity automatically
* can expose consistent status to the CLI
* reduces startup friction

### Unity reconnect behavior

Unity-side integration should reconnect after reload automatically.

This prevents script reload from acting like a total system reset.

---

## Unity Bridge Responsibilities

The Unity bridge should execute operations inside Unity, not merely mirror files on disk.

It should be responsible for:

* prefab operations
* component operations
* reflection-based type lookup
* serialized property assignment
* scene/object creation
* play mode transition hooks
* console and state reporting

This is important because many Unity operations are more reliable when performed through Unity systems rather than raw file mutation alone.

---

## Observability and Debugging

The architecture should make it easy to answer:

* What commands are currently queued?
* Which commands are waiting?
* What are they waiting for?
* Did the last compile succeed?
* What compiler errors currently exist?
* Which commands succeeded or failed?
* Which commands belong to the current task?

Recommended read-only commands:

* get queue
* get command status
* get compile status
* get recent console entries
* get task summary

This is essential for reliable agent iteration.

---

## Runtime / Play Mode Extension

The architecture should support editor automation first, but it should leave room for runtime interactions later.

Future capabilities may include:

* enter play mode
* trigger game-side commands
* inspect runtime objects
* drive test scenarios
* collect runtime logs or results

This should reuse the same general model:

* clear command surface
* internal requirements
* queue state visibility
* explicit runtime readiness conditions

---

## MCP Positioning

MCP is optional.

This architecture should not depend on MCP for its core reliability.

Reason:

* the main reliability problem is Unity lifecycle synchronization, not protocol standardization
* a local daemon plus internal scheduler solves the actual problem
* MCP can be added later as an external compatibility layer if useful

Recommended stance:

* do not build the hot path around MCP
* optionally expose MCP on top of the daemon later

That way, the system remains useful even if no MCP server is involved.

---

## Recommended Public Tool Categories

These are categories, not final CLI syntax.

### Discovery

* find assets
* resolve asset
* inspect prefab
* inspect scene object

### Creation and mutation

* create script
* create prefab
* add component
* set serialized property
* instantiate prefab
* save asset or scene

### Status and diagnostics

* get queue
* get command status
* get compile status
* get console
* get task summary

### Runtime

* enter play mode
* execute runtime action
* inspect runtime state

The exact CLI syntax can be decided later based on what Claude handles best.

---

## Non-Goals

This document does not lock down:

* exact CLI syntax
* exact JSON schema details
* daemon implementation language
* transport choice between named pipes / WebSocket / other local IPC
* exact retry thresholds
* final task cancellation semantics

These should remain flexible.

---

## Recommended Next Step

Design two artifacts separately:

1. **Agent-facing CLI spec**

   * command categories
   * argument shapes
   * output format
   * error format
   * status query format

2. **Internal command schema and queue state model**

   * required fields
   * optional fields
   * requirements model
   * status model
   * dependency model
   * retry/blocking policy

That preserves the central architectural split:

**design the public interface for Claude**

while

**designing the internal runtime for Unity correctness and reliability**
