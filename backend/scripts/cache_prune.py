"""
Drop cache documents from superseded schema generations.

Every cache key carries the schema it was built with — `race:v20:2023:3:R` —
so bumping CACHE_SCHEMA does not overwrite the old document, it writes a new
one beside it. Nothing ever reads the old one again, but it keeps its space:
measured before the first prune, 1,167 documents of which about 1,100 were
generations v2 to v19, on a 512 MB Atlas M0 where one race payload is 1.2 MB.

`cache_set` now drops the previous generation of each key as it writes, so
this is a one-off catch-up rather than something to run on a schedule.

    .venv/Scripts/python.exe scripts/cache_prune.py            # dry run
    .venv/Scripts/python.exe scripts/cache_prune.py --apply    # delete
"""
import sys
import os
import re
import collections

sys.path.insert(0, os.getcwd())

import database                                          # noqa: E402
from services.session_loader import CACHE_SCHEMA         # noqa: E402


def main():
    apply = "--apply" in sys.argv

    database._connect()
    if database._cache is None:
        print("No cache configured (MONGODB_URI unset?) — nothing to do.")
        return 1

    # What is in there, by generation, before anything is touched.
    by_gen = collections.Counter()
    bytes_by_gen = collections.Counter()
    for doc in database._cache.find({}, {"_id": 1, "gz_bytes": 1}):
        m = re.match(r"^([a-z]+):(v\d+):", str(doc["_id"]))
        gen = m.group(2) if m else "(no schema)"
        by_gen[gen] += 1
        bytes_by_gen[gen] += int(doc.get("gz_bytes") or 0)

    def gen_key(g):
        return int(g[1:]) if g.startswith("v") and g[1:].isdigit() else -1

    print(f"current schema: {CACHE_SCHEMA}\n")
    print(f"  {'generation':<14}{'docs':>7}{'MB':>9}")
    for gen in sorted(by_gen, key=gen_key):
        mark = "  <- current" if gen == CACHE_SCHEMA else ""
        print(f"  {gen:<14}{by_gen[gen]:>7}{bytes_by_gen[gen]/1e6:>9.1f}{mark}")

    kept, removed, freed = database.cache_drop_stale(CACHE_SCHEMA, dry_run=not apply)
    print()
    if apply:
        print(f"REMOVED {removed} documents, freeing {freed/1e6:.1f} MB.")
        print(f"KEPT    {kept} on {CACHE_SCHEMA}.")
    else:
        print(f"Would remove {removed} documents, freeing {freed/1e6:.1f} MB, "
              f"keeping {kept} on {CACHE_SCHEMA}.")
        print("Re-run with --apply to do it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
