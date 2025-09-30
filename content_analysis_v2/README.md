# Content Analysis (Schema-Locked) — Preview-first Flow (v2)

Changes in this version:
- **DG upload** now generates a **JSON preview** rendered in the UI, **no automatic Excel download**.
- **Tabs per section** (your sheet names) let you flip through the preview.
- **Export Excel** button exports the current preview JSON to a .xlsx matching your exact schema.

## Endpoints
- `POST /api/caX/preview`  (multipart: `dg`)              → JSON (by sheet) for on-screen preview
- `POST /api/caX/export`   (application/json: { data })   → returns .xlsx built from the preview JSON
- `POST /api/caX/upload`   (multipart: `file`, `projectId`) → persists an existing CA file
- `GET  /api/caX/:projectId`                               → parsed JSON
- `GET  /api/caX/template`                                 → blank template (exact headers)

Mount:
```js
import caXRouter from './backend/routes/contentAnalysisX.routes.mjs';
app.use('/api/caX', caXRouter);
```

Env:
```
OPENAI_API_KEY=...
FILES_DIR=./uploads
```
