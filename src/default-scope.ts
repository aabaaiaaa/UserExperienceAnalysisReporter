/**
 * Built-in default evaluation scope for UX analysis.
 * Used when --scope is not provided and printed by --show-default-scope.
 */
export const DEFAULT_SCOPE = `# UX Evaluation Scope

Evaluate the web application against each of the following criteria. For each area, note any issues, inconsistencies, or opportunities for improvement.

## 1. Layout Consistency and Spacing
- Are margins, padding, and spacing consistent across pages and components?
- Do similar elements use the same sizing and alignment patterns?
- Is the visual grid respected throughout the application?
- Are there any misaligned elements or inconsistent gaps?

## 2. Navigation Flow and Discoverability
- Can users reach all areas of the app through clear navigation paths?
- Are there any dead-end pages with no way to navigate back?
- Is the navigation structure logical and predictable?
- Are important actions and pages easy to find?
- Do breadcrumbs, menus, and links behave consistently?

## 3. Form Usability and Validation Feedback
- Do forms provide clear labels for all fields?
- Is validation feedback shown inline and in real time where appropriate?
- Are required fields clearly marked?
- Do error messages explain what went wrong and how to fix it?
- Is the tab order logical and do forms support keyboard submission?
- Are form controls (inputs, selects, checkboxes) consistent in style and behavior?

## 4. Error Messaging and Empty States
- Do error states provide clear, helpful, and non-technical messages?
- Are empty states (no data, no results, first-time use) handled with guidance or calls to action?
- Are error messages consistent in tone, placement, and style across the app?
- Do errors offer a recovery path (retry, go back, contact support)?

## 5. Loading States and Transitions
- Do all asynchronous operations show loading indicators?
- Are loading skeletons or placeholders used where appropriate?
- Do loading states match the layout of the content they replace?
- Are transitions between states smooth and non-jarring?
- Is there feedback for long-running operations?

## 6. Accessibility Basics
- Do all interactive elements have sufficient color contrast (WCAG AA minimum)?
- Are all form inputs associated with visible labels?
- Is focus management correct — can the app be navigated entirely by keyboard?
- Are focus indicators visible and consistent?
- Do images have meaningful alt text?
- Are ARIA roles and labels used correctly where semantic HTML is insufficient?

## 7. Responsiveness and Viewport Behavior
- Does the layout adapt appropriately to different viewport widths?
- Are there any horizontal scroll issues at common breakpoints?
- Do touch targets meet minimum size guidelines on mobile viewports?
- Are images and media properly scaled across viewport sizes?
- Does the content remain readable and usable at all supported sizes?

## 8. Interactive Element Consistency
- Do buttons of the same level/importance share the same styling (color, size, shape)?
- Do links look and behave consistently throughout the app?
- Are hover, focus, and active states present and consistent for all interactive elements?
- Are disabled states visually clear and consistent?
- Do clickable elements use appropriate cursor styles?

## 9. Content Hierarchy and Readability
- Is there a clear visual hierarchy (headings, subheadings, body text)?
- Are font sizes, weights, and styles used consistently for each level?
- Is line length comfortable for reading (roughly 50-75 characters)?
- Is there sufficient contrast between text and background?
- Are paragraphs and sections spaced for easy scanning?

## 10. Terminology and Labeling Consistency
- Is the same action called the same thing everywhere (e.g., not "Save" in one place and "Submit" in another for the same operation)?
- Are labels, headings, and button text consistent in style (e.g., sentence case vs title case)?
- Is domain terminology used consistently throughout the app?
- Are abbreviations and acronyms used consistently and explained where needed?
`;
