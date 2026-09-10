import asyncio
import os
import sys

# Add backend to path so we can import services
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.fastf1_service import get_track_data

async def run_debug():
    print("Triggering Trace for Spa (Belgium)...")
    try:
        # We test Belgium 2023 (Round 12) to match user's case
        data = await get_track_data(2023, 12, "R")
        print("[OK] Function completed successfully")
    except Exception as e:
        print(f"[ERROR] {e}")

if __name__ == "__main__":
    asyncio.run(run_debug())
