# UI Components

Shared design tokens, base styles, and framework-light presentational helpers for the active dashboard and storefront apps.

Import the CSS once from each app entry point:

```ts
import "@booking/ui-components/styles.css";
```

Keep this package free of booking-specific business rules. Domain state, permissions, and workflow contracts belong in `packages/shared-types` and backend APIs.