from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scandrop.pipeline.import_gltf import create_scene_from_gltf
from scandrop.store import FileSceneStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest a GLB/GLTF file into scandrop scene storage.")
    parser.add_argument("path", help="Local path to .glb or .gltf file")
    args = parser.parse_args()

    store = FileSceneStore()
    scene_id, version = create_scene_from_gltf(path=args.path, store=store)
    print(json.dumps({"scene_id": scene_id, "version": version}, indent=2))


if __name__ == "__main__":
    main()
