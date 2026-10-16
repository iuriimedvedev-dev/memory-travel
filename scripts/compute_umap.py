"""Offline UMAP layout over STORED vectors (no live calls).

Inputs (read-only): vdb_entities.json / vdb_chunks.json matrices (base64
float32, 768-dim) + node_index.json (entity order from export_graph.py).

Outputs (into ../public/data/):
  coords_entities.json  {ids:[...], xy:[[x,y]...]}  (47k, UMAP cosine)
  coords_chunks.json    {chunk_id: [x,y]}           (2.8k, same fit space? no:
                         separate fit over chunk vectors)

Entity order MUST match vdb `data` order intersected with node_index.json;
we emit ids + xy so the client joins by id (robust to order drift).
UMAP params fixed + random_state=42 for reproducibility.

CPU-only (no GPU jobs on this box). ~minutes for 47k points.
"""
import base64
import json
import sys
from pathlib import Path

import numpy as np

INDEX = Path("/home/angkira/.local/share/hars-graphrag/index_compact_20260903_imported")
DATADIR = Path(__file__).resolve().parent.parent / "app" / "public" / "data"


def load_matrix(name):
    d = json.load(open(INDEX / name))
    raw = base64.b64decode(d["matrix"])
    n = len(d["data"])
    dim = d.get("embedding_dim", 768)
    arr = np.frombuffer(raw, dtype=np.float32, count=n * dim).reshape(n, dim).copy()
    return d["data"], arr


def fit_umap(X, seed=42):
    import umap

    reducer = umap.UMAP(
        n_neighbors=15, min_dist=0.35, metric="cosine", random_state=seed
    )
    return reducer.fit_transform(X)


def norm(xy):
    mins = xy.min(axis=0)
    maxs = xy.max(axis=0)
    xy = (xy - mins) / np.maximum(maxs - mins, 1e-9)  # [0,1]
    return (xy * 2 - 1).astype(np.float64)  # [-1,1]


def main():
    import umap  # noqa: fail fast if missing

    print("loading entity vectors...", flush=True)
    edata, X = load_matrix("vdb_entities.json")
    print("entities:", X.shape, flush=True)
    print("fitting UMAP (entities)...", flush=True)
    Xe = norm(fit_umap(X))
    eids = [r.get("__id__") for r in edata]
    # vdb entity ids are ent-... hashes, NOT graphml names. Join key instead:
    # data[].entity_name <-> graphml entity_id. Emit name-keyed coords.
    names = [r.get("entity_name", "") for r in edata]
    out = {"ids": names, "xy": [[round(float(a), 4), round(float(b), 4)] for a, b in Xe]}
    with open(DATADIR / "coords_entities.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote coords_entities.json", flush=True)

    print("loading chunk vectors...", flush=True)
    cdata, C = load_matrix("vdb_chunks.json")
    print("chunks:", C.shape, flush=True)
    print("fitting UMAP (chunks)...", flush=True)
    Xc = norm(fit_umap(C, seed=43))
    cids = [r.get("__id__", "") for r in cdata]
    outc = {
        cid: [round(float(a), 4), round(float(b), 4)]
        for cid, (a, b) in zip(cids, Xc)
    }
    with open(DATADIR / "coords_chunks.json", "w") as f:
        json.dump(outc, f, separators=(",", ":"))
    print("wrote coords_chunks.json", flush=True)


if __name__ == "__main__":
    sys.exit(main())
