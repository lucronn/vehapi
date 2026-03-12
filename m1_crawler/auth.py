import httpx
import asyncio
import logging
from urllib.parse import urlparse

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

EBSCO_LOGIN_URL = "https://search.ebscohost.com/login.aspx?authtype=uid&user=pl7321r&password=PL%3F7321R&profile=autorepso&groupid=remote"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

async def get_authenticated_client():
    """
    Establish an authenticated session by following the EBSCO -> Motor redirect flow.
    Returns an httpx.AsyncClient with the necessary cookies.
    """
    client = httpx.AsyncClient(
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
        timeout=30.0
    )
    
    try:
        logger.info("Starting authentication flow...")
        # 1. Hit the EBSCO login URL. It will redirect multiple times.
        response = await client.get(EBSCO_LOGIN_URL)
        
        # Check if we ended up on motor.com or still on ebsco
        final_url = str(response.url)
        logger.info(f"Final URL after redirects: {final_url}")
        
        if "motor.com" in final_url:
            logger.info("✓ Successfully redirected to motor.com")
        else:
            logger.warning("Did not reach motor.com. Auth might have failed or shifted.")
            
        # Verify we have some cookies
        if not client.cookies:
            logger.error("No cookies captured during auth flow.")
            raise Exception("Authentication failed: No cookies captured.")
            
        logger.info("✓ Session established with cookies.")
        return client
        
    except Exception as e:
        logger.error(f"Authentication failed: {e}")
        await client.aclose()
        raise

if __name__ == "__main__":
    async def test_auth():
        try:
            client = await get_authenticated_client()
            # Try a simple API call to verify
            resp = await client.get("https://sites.motor.com/m1/api/years")
            if resp.status_code == 200:
                logger.info("✓ API verification success: Received years list.")
                print(resp.json())
            else:
                logger.error(f"API verification failed: {resp.status_code}")
            await client.aclose()
        except Exception as e:
            print(f"Test failed: {e}")

    asyncio.run(test_auth())
