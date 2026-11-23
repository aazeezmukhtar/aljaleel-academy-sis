# AcadMe UI/UX Architecture

**Status:** Baseline architecture for gradual system-wide adoption  
**Scope:** Admin, Teacher/Staff, Student Portal, and public-facing school pages  
**Implementation constraint:** EJS + vanilla CSS/JavaScript. This architecture does not introduce a frontend framework, new product features, routes, permissions, or data changes.

## 1. Goals and design principles

AcadMe should feel like one coherent product across every role and module. Pages may have different workflows, but they should share the same visual language and interaction rules.

1. **Consistent, not identical:** dashboards, tables, forms, portals, and public pages use shared foundations while retaining layouts appropriate to their tasks.
2. **Mobile-first and content-first:** essential tasks work at narrow widths without oversized cards, clipped content, or horizontal page overflow.
3. **Quiet visual hierarchy:** compact typography, restrained surfaces and shadows, clear spacing, and emphasis reserved for important actions or status.
4. **Accessible by default:** keyboard access, visible focus, semantic controls, readable contrast, and touch targets.
5. **Offline-aware:** existing offline workflows must communicate cached, draft, pending-sync, and unavailable states clearly. Styling must not imply that an action succeeded when it has not.
6. **Presentation stays separate from business logic:** CSS and shared UI scripts must not change permissions, calculations, persistence, or route behavior.

## 2. Layered architecture

The UI is organized into five layers. New work should use the lowest suitable layer and avoid duplicating rules in page-specific stylesheets.

| Layer | Responsibility | AcadMe implementation |
|---|---|---|
| 1. Design tokens | Brand, color, type, spacing, radius, shadow, motion, z-index | `public/css/acadme-tokens.css` |
| 2. UI primitives | Buttons, fields, cards, badges, icons, tables, dialogs, navigation | Shared CSS utilities and reusable EJS partials |
| 3. Patterns | Search/filter bars, page headers, stat groups, empty states, list rows, confirmation flows | Shared pattern classes and partials |
| 4. Shells | Responsive navigation, page frame, top bar, content area, footer/bottom navigation | Staff/Admin shell and Student Portal shell |
| 5. Feature pages | Attendance, Results, Students, Fees, Academics, Reports, Settings, CMS, Portal | Existing route-specific EJS templates and feature styles |

**Dependency direction:** Feature pages consume patterns; patterns consume primitives; primitives consume tokens. Lower layers must not depend on feature-page selectors.

## 3. Design tokens

`acadme-tokens.css` is the single source of truth for shared design values.

- Use `--acm-*` variables for colors, typography, spacing, radii, shadows, transitions, focus rings, and stacking order.
- School-configured primary and secondary colors may override designated brand tokens at runtime. They must not replace semantic success, warning, error, or information colors.
- Prefer existing tokens over adding near-duplicate values. Add a token only when it represents a reusable design decision.
- Use logical CSS properties (`padding-inline`, `margin-inline`, `inset-inline`) so Arabic/RTL layouts can mirror correctly.
- Use the existing Plus Jakarta Sans / Noto Sans Arabic font stack; do not introduce page-specific font families without a documented need.

### Typography scale

Use the token scale rather than arbitrary large headings:

- `xs` / `sm`: metadata, helper text, compact labels.
- `base`: normal interface text and table cells.
- `md`: controls and emphasized body text.
- `lg` / `xl`: section titles and card headings.
- `2xl` / `3xl`: page titles or major dashboard metrics only, with responsive clamping.

Dashboard metric values should remain visually subordinate to the page title and must fit their card at 320px-wide viewports.

## 4. Shared component rules

| Component | Standard |
|---|---|
| Page header | Compact title, optional subtitle/breadcrumb, actions aligned without pushing content down |
| Mobile top bar | Approximately 64–68px high; 44px controls; brand/title centered in the available space; no oversized vertical padding |
| Content container | Fluid width, consistent horizontal gutters, sensible maximum width |
| Cards | White/surface background, 1px subtle border, medium radius, minimal shadow, compact padding |
| Stat tiles | Consistent icon size, compact metric, short label; two columns on narrow screens when content permits |
| Buttons | Clear primary/secondary/destructive hierarchy; consistent height, radius, disabled/loading/focus states |
| Forms | Persistent labels, inline validation, grouped related fields, full-width controls on phones |
| Tables | Semantic table markup; responsive horizontal container when columns cannot safely collapse |
| Lists | Consistent row height, dividers, truncation only when full detail remains accessible |
| Feedback | Shared loading, empty, error, success, offline, and pending-sync treatments |
| Navigation | Same active, hover, focus, selected, and disabled language across shells |

Do not make every panel a large rounded card. Use a card only when grouping content improves comprehension. Prefer compact list sections for dense operational data.

## 5. Responsive layout standards

Use the existing breakpoint conventions as the baseline and test at 320, 360, 390, 430, 768, 992, and 1280px.

- **Phones:** single-column page sections; compact two-column metric grids where labels fit; no clipped headings or action buttons.
- **Tablet:** two-column content where it improves scanning; preserve readable form widths.
- **Desktop:** use available width without stretching reading-heavy content; tables may use wider containers.
- The mobile shell must reserve space for its fixed top and bottom navigation without hiding page content.
- No page-level horizontal overflow. A table may scroll inside its own responsive wrapper.
- Controls must remain reachable with one hand where practical; touch targets should generally be at least 44px.

## 6. Shells and navigation

There are distinct shells, but they consume the same tokens and component standards:

- **Admin/Staff shell:** shared mobile top bar, sidebar navigation, page content frame, notification control, and existing bottom navigation.
- **Student Portal shell:** portal navigation and content frame using the same tokens, typography, cards, fields, and feedback patterns.
- **Public website shell:** public navigation and content frame using the same brand tokens, type scale, buttons, forms, and accessibility standards.

Role-specific navigation items remain governed by the existing authorization and template conditions. A visual component must never reveal a link or action the current role is not allowed to use.

## 7. CSS and EJS organization

Recommended stylesheet responsibilities:

1. `acadme-tokens.css` — variables only; no page-specific selectors.
2. Shared primitive/pattern stylesheet — reusable component classes.
3. Shell stylesheet — responsive navigation and page frame.
4. Portal or staff/admin presentation layer — shell-specific composition.
5. Feature stylesheet — genuinely feature-specific layout only.

Keep selectors scoped by component or shell (for example, `.acm-card`, `.acm-page-header`, `.staff-shell`). Avoid broad overrides such as styling every `h3` or every `.card` differently in unrelated modules.

Reusable EJS partials should be used for repeated structural UI only. They must receive explicit data and must not contain database queries or business rules. Keep existing route handlers and server-side authorization as the source of truth.

## 8. Accessibility, localization, and offline states

- Use native buttons, links, labels, headings, and table semantics.
- Every icon-only control needs an accessible name; dropdowns and expandable lists expose their expanded state.
- Keep visible `:focus-visible` styling and sufficient text/background contrast.
- Do not communicate status by color alone.
- Allow text wrapping for long names, translated labels, and Arabic text. Use RTL-aware logical properties.
- Shared feedback patterns must distinguish: saved locally, queued for sync, synced, sync failed, offline/unavailable, and server-confirmed success. Do not collapse these into one generic success state.
- Respect reduced-motion preferences.

## 9. Naming and contribution rules

- Tokens: `--acm-*`.
- Shared component classes: `.acm-*`.
- Shell classes: `.staff-shell`, `.student-shell`, `.public-shell` (or existing shell classes during migration).
- Feature classes: namespaced by feature where necessary.
- Avoid new global CSS overrides and inline styles for reusable presentation.
- Before adding a component, search for an existing equivalent and extend it rather than creating a duplicate.

## 10. Adoption plan

Adopt this architecture incrementally; do not rewrite the entire application in one release.

1. **Foundation:** load the token layer in every shell; document component contracts; standardize the shared mobile header and typography.
2. **Admin/Staff shell:** unify top bar, page header, content gutters, cards, stat tiles, buttons, forms, tables, and feedback states.
3. **High-use modules:** migrate Students, Attendance, Results, Fees, Academics, and Reports in small audited batches.
4. **Student Portal:** align shared primitives while preserving portal-specific navigation and existing portal behavior.
5. **Public website:** adopt brand tokens, typography, forms, buttons, responsive rules, and accessibility patterns.
6. **Governance:** add visual regression checks at representative widths and reject feature CSS that redefines shared tokens or primitives without justification.

Each migration must be presentation-only unless a separate, explicitly approved functional change is requested. Run existing tests and module smoke checks after each batch. Do not perform bulk database or production data changes as part of UI migration.

## 11. Acceptance checklist

- [ ] Shared tokens load before component styles in each shell.
- [ ] Header height and control sizes are consistent across mobile pages.
- [ ] Page title, content gutters, card density, and typography follow the shared scale.
- [ ] No text or controls are clipped at 320–430px.
- [ ] Forms, tables, empty states, loading states, and errors have consistent patterns.
- [ ] Arabic/RTL and long translated strings remain readable.
- [ ] Keyboard focus and screen-reader labels remain intact.
- [ ] Existing role permissions, offline persistence, routes, and business workflows are unchanged.
- [ ] Representative Admin, Teacher, Student Portal, and public pages pass responsive smoke tests.
