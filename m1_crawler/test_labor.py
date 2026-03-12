"""Quick test of labor endpoint. L: (Labor) articles only; P: (Procedure) IDs are different."""
import asyncio
from auth import get_authenticated_client
from client import M1Client

async def main():
    print("Authenticating...")
    http_client = await get_authenticated_client()
    client = M1Client(http_client)

    tests = [
        ("60913:3561", "L:25747288"),  # Known working
        ("66966:2600", "L:25760276"),  # Suzuki Equator - Labor bucket "ABS Hydraulic Control Unit R&R"
    ]

    for vehicle_id, article_id in tests:
        print(f"\nTesting: MOTOR / {vehicle_id} / {article_id}")
        labor = await client.get_labor("MOTOR", vehicle_id, article_id)
        if labor:
            print("  OK")
        else:
            print("  FAIL (404/5xx)")

    await http_client.aclose()
    print("\nDone.")

if __name__ == "__main__":
    asyncio.run(main())
