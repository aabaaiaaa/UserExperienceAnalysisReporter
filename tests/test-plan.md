# Home / New Game Screen

- Page Header
  - Checked: Layout consistency, content hierarchy
  - Sub-elements:
    - H1 "SPACE AGENCY" with rocket logo
    - H2 "NEW GAME" section
- Agency Name Input
  - Checked: Form usability, validation feedback, accessibility (labels, ARIA, focus order)
  - Sub-elements:
    - Text input with character counter (0/48) and placeholder
    - Validation error message on empty submit
- Game Mode Selection
  - Checked: Interactive element consistency, accessibility
  - Sub-elements:
    - Radio buttons: Tutorial, Free Play, Sandbox
    - Sandbox-specific checkboxes (malfunctions, weather)
- START GAME Button
  - Checked: Form validation trigger, layout spacing

# Welcome Modal

- Modal Content
  - Checked: Content hierarchy and readability, interactive element consistency
  - Sub-elements:
    - "Welcome to [Agency Name]!" heading
    - Game mode subheading (e.g., FREEPLAY MODE)
    - Description text explaining game mode
    - "Let's Go!" dismiss button

# Game Hub

- Top Bar
  - Checked: Layout consistency, navigation flow and discoverability, responsiveness (mobile 375px, tablet 768px, desktop 1280px), accessibility
  - Sub-elements:
    - Agency name display
    - Game mode badge (e.g., FREEPLAY)
    - Flight counter
    - Funds button (e.g., $2,000,000)
    - Missions button
    - Hamburger menu (☰)
- Reputation Panel
  - Checked: Content hierarchy, layout consistency
  - Sub-elements:
    - Numeric score, label (e.g., GOOD), progress bar
- Weather Panel
  - Checked: Content hierarchy
  - Sub-elements:
    - Wind speed, ISP effect, visibility
- Building Blocks
  - Checked: Navigation flow, responsiveness, layout spacing
  - Sub-elements:
    - Launch Pad block with label
    - Vehicle Assembly Building block with label
    - Mission Control Centre block with label

# Hamburger Menu

- Menu Dropdown
  - Checked: Navigation flow and discoverability, interactive element consistency
  - Sub-elements:
    - Construction
    - Settings
    - Save Game
    - Load Game
    - Help
    - Exit to Menu (styled in red/warning color)

# Loan Details Dialog

- Loan Information Table
  - Checked: Layout consistency, accessibility (labels)
  - Sub-elements:
    - Outstanding balance, Interest rate, Interest on next mission, Total interest accrued
- Pay Down Loan Section
  - Checked: Form usability, validation feedback, error messaging
  - Sub-elements:
    - Amount input and Pay Down button
    - Validation message for negative amount (truncated text observed)
- Borrow More Section
  - Checked: Form usability
  - Sub-elements:
    - Amount input and Borrow button
- Dialog Chrome
  - Checked: Interactive element consistency
  - Sub-elements:
    - "Loan Details" heading with ✕ close button

# Launch Pad

- Header
  - Checked: Layout consistency, navigation flow (back button)
  - Sub-elements:
    - "← Hub" back button
    - "Launch Pad — Tier 1 (Basic)" heading with "Max Mass: 18t"
- Weather Bar
  - Checked: Content hierarchy
  - Sub-elements:
    - Wind, ISP, visibility indicators
- Skip Day Button
  - Checked: Interactive element consistency
  - Sub-elements:
    - "Skip Day ($25k)" button
- Empty State
  - Checked: Empty states, error messaging
  - Sub-elements:
    - "No rockets are ready for launch." message
    - Guidance text about building in VAB

# Vehicle Assembly Building (VAB)

- Toolbar
  - Checked: Layout consistency, interactive element consistency, accessibility (labels, ARIA), responsiveness at mobile viewport
  - Sub-elements:
    - ← Hub, Inventory, Rocket Engineer, Staging, Mirror, Clear All, Undo, Redo, Save, Library, Launch
- Zoom Controls
  - Checked: Interactive element consistency
  - Sub-elements:
    - Zoom to Fit button, Auto Zoom checkbox, zoom slider
- Stats Bar
  - Checked: Layout consistency
  - Sub-elements:
    - Parts count, Mass, Cost (partially truncated observed)
- Parts Panel (Right Side)
  - Checked: Content hierarchy
  - Sub-elements:
    - Categorized parts: Command Modules, Computer Modules, Service Modules, Fuel Tanks, Engines, Parachutes
- Build Grid
  - Checked: Layout consistency
  - Sub-elements:
    - Green gridlines with 0m marker
- Inventory Panel
  - Checked: Empty states, navigation flow
  - Sub-elements:
    - "Part Inventory" heading with close button (✕)
    - Empty state: "No recovered parts. Land safely to recover parts from flights."
- Rocket Engineer Panel
  - Checked: Error messaging, empty states, content hierarchy
  - Sub-elements:
    - Stats: Total Mass, Stage 1 Thrust, TWR
    - Checklist with ✗ markers: Command Module, Part Connectivity, Stage 1 Engine, Thrust-to-Weight
    - "Resolve failures to enable launch" message
- Staging Panel
  - Checked: Layout consistency, interactive element consistency
  - Sub-elements:
    - Altitude display with air density
    - Total ΔV display
    - "UNSTAGED PARTS" section
    - "Stage 1 — FIRES FIRST" with drop zone
    - "+ Add Stage" button

# Mission Control Centre

- Header and Navigation
  - Checked: Navigation flow and discoverability, tab accessibility (ARIA roles), responsiveness at tablet viewport, layout consistency
  - Sub-elements:
    - "← Hub" back button
    - "Mission Control Centre — Tier 1 (Basic)" heading
    - 7 tabs with dividers: Missions, Accepted, Completed | Contracts, Active | Challenges, Achievements
- Missions Tab
  - Checked: Layout consistency, interactive element consistency
  - Sub-elements:
    - Mission cards with reward info and "Accept Mission" button (e.g., "First Flight" — $15,000)
- Accepted Tab
  - Checked: Empty states, terminology consistency
  - Sub-elements:
    - Empty state: "No missions currently accepted. Visit the Available tab to take on a mission."
    - Note: references "Available tab" but tab is labeled "Missions"
- Completed Tab
  - Checked: Empty states
  - Sub-elements:
    - Empty state: "No missions completed yet. Accept a mission and launch to get started!"
- Contracts Tab
  - Checked: Empty states, layout consistency
  - Sub-elements:
    - Tier info: "Mission Control: Tier 1 (Basic)" with upgrade hint
    - Slot info: "Board: 0/4 slots | Active: 0/2 slots"
    - Reputation display (score, label, progress bar)
    - Empty state: "No contracts on the board. Complete a flight to generate new contracts."
- Active Tab
  - Checked: Empty states
  - Sub-elements:
    - "Active: 0/2 slots"
    - Empty state: "No active contracts. Visit the Contracts tab to accept one."
- Challenges Tab
  - Checked: Empty states, interactive element consistency
  - Sub-elements:
    - "0 of 0 challenges completed"
    - "+ Create Challenge" button
    - "Import JSON" button
    - "Complete more tutorial missions to unlock challenges" message
- Create Challenge Form
  - Checked: Form usability, validation feedback, accessibility (labels), error messaging on empty submit
  - Sub-elements:
    - Title input
    - Description textarea
    - Objectives section: select dropdown + value input + X delete button + Add Objective button
    - Score Metric dropdown
    - Medal Thresholds: Bronze/Silver/Gold inputs
    - Rewards: Bronze/Silver/Gold inputs
    - Create / Cancel buttons
- Achievements Tab
  - Checked: Layout consistency, content hierarchy
  - Sub-elements:
    - "0 of 10 achievements earned"
    - 2-column grid of achievement cards
    - Each card: moon icon, title, description, reward ($), rep bonus
    - Cards appear dimmed/locked

# Construction Screen

- Header
  - Checked: Content hierarchy
  - Sub-elements:
    - "Construction" heading with "BUILD NEW FACILITIES FOR YOUR AGENCY" subtitle
- Existing Facility Cards
  - Checked: Layout consistency, interactive element consistency (disabled states)
  - Sub-elements:
    - Launch Pad (Tier 1, upgrade button)
    - VAB (Tier 1, upgrade button)
    - Mission Control (Tier 1, upgrade button)
- New Facility Cards
  - Checked: Layout consistency, content hierarchy
  - Sub-elements:
    - Crew Administration, Tracking Station, R&D Lab, Satellite Network Ops, Library
    - Each card: cost, description, Build button
    - R&D Lab Build button disabled (requires 20 science)
    - Discounted prices shown with strikethrough
- Navigation
  - Checked: Navigation flow
  - Sub-elements:
    - "← Hub" back button at bottom

# Settings Screen

- Header
  - Checked: Content hierarchy
  - Sub-elements:
    - "Game Settings" heading
    - "DIFFICULTY OPTIONS — CHANGES TAKE EFFECT IMMEDIATELY" subtitle
- Setting Controls
  - Checked: Form usability, accessibility (ARIA roles for toggle groups), layout consistency
  - Sub-elements:
    - Malfunction Frequency (Off/Low/Normal/High)
    - Weather Severity (Off/Mild/Normal/Extreme)
    - Financial Pressure (Easy/Normal/Hard)
    - Crew Injury Duration (Short/Normal/Long)
    - Auto-Save (On/Off)
    - Debug Mode (On/Off)
    - Worker Physics (On/Off)
- Navigation
  - Checked: Navigation flow
  - Sub-elements:
    - "← Hub" back button

# Help Screen

- Sidebar Navigation
  - Checked: Navigation flow, content hierarchy and readability
  - Sub-elements:
    - Topic list: Getting Started, Space Agency Hub, Vehicle Assembly, Flight Controls, etc.
- Content Area
  - Checked: Content hierarchy and readability
  - Sub-elements:
    - Topic text
    - Table of game modes
- Chrome
  - Checked: Interactive element consistency
  - Sub-elements:
    - Close button (×)
    - "Close Help" button at bottom
