# Scandrop Web Workbench

Next.js + shadcn-style UI for:

- uploading a GLB/GLTF scan (file picker or drag/drop)
- viewing the original GLB/GLTF scan after upload
- viewing derived spatial geometry (floor polygon + obstacle footprints)
- chatting via AI SDK UI (`useChat`) with MCP-backed placement/status tools

![Scandrop web bedside table placement](../docs/screenshots/web-bedside-placement.png)

## Run

```bash
cd /Users/jan/Developer/scandrop/web
npm install
npm run dev
```

Open `http://localhost:3000`.

## Runtime assumptions

- Python environment with `scandrop` dependencies is available at `/Users/jan/Developer/scandrop/.venv`.
- MCP server is started on-demand over stdio from the web backend using:
  - `/Users/jan/Developer/scandrop/.venv/bin/python -m scandrop.main`

Override defaults if needed:

- `SCANDROP_REPO_ROOT`
- `SCANDROP_PYTHON`

## Example chat prompts

- `list scenes`
- `summary`
- `status`
- `find free spaces size 1.2x0.7x0.8 clearance 0.2`
- `check fit size 1.2x0.7x0.8 pos 1.0,-1.1,-2.2 yaw 0 clearance 0.2`

## Step-by-step tutorial (web app)

1. Start the app:

```bash
cd /Users/jan/Developer/scandrop/web
npm install
npm run dev
```

2. Open `http://localhost:3000`.
3. Click `New Scene`, then upload a `.glb` file.
4. Wait for scene processing to complete and verify badges in the top bar (`scene id`, `v1`, `obstacles`).
5. In the chat panel, ask:

```text
Where do I fit a bedside table by this bed?
```

6. The assistant will call `find_free_spaces`, return the best placement, and render a placement preview in 3D.
7. Switch between `3D Model` and `Floor Plan` tabs to inspect the recommended location.
