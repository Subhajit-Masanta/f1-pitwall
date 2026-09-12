"""
📄 payload.py — shaping a processed payload before it is cached or sent.

Shared by the replay endpoints (track + lap), which both emit dense point
arrays and both pay for every wasted digit twice: once over the wire and once
in the Mongo cache document.
"""


def trim(payload):
    """
    Drop pointless float precision before caching / sending.

    Coordinates are in tenths of a metre and the whole lap renders into a few
    hundred screen pixels, so 1dp is far below anything visible — but it cuts
    the JSON roughly in half (485 KB -> 331 KB raw, 133 KB -> 55 KB gzipped).
    """
    for p in payload.get("telemetry", []):
        p["x"] = round(p["x"], 1)
        p["y"] = round(p["y"], 1)
        p["distance"] = round(p["distance"], 1)
        p["time"] = round(p["time"], 3)
        p["speed"] = round(p["speed"], 1)
        p["throttle"] = round(p["throttle"], 1)
        p["brake"] = round(p["brake"], 2)
        if "g" in p:
            p["g"] = round(p["g"], 2)
    for p in payload.get("track_points", []):
        p["X"] = round(p["X"], 1)
        p["Y"] = round(p["Y"], 1)
        p["D"] = round(p["D"], 1)
        if "S" in p:
            p["S"] = round(p["S"], 1)
        if "T" in p:
            p["T"] = round(p["T"], 1)
        if "A" in p:
            p["A"] = round(p["A"], 2)
    return payload
