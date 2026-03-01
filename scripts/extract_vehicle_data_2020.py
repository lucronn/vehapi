import requests
import json
import time
import os

# Configuration
YEAR = 2020
DIVERSE_MAKES = [
    "Toyota", "Ford", "Tesla", "BMW", "Honda", 
    "Chevrolet", "Mercedes-Benz", "Jeep", "Hyundai", "Kia"
]

# Session Info (Extracted from environment variables to avoid hardcoded secrets)
COOKIES = {
    "UIUserSettings": os.environ.get("MOTOR_UI_USER_SETTINGS", ""),
    "AuthUserInfo": os.environ.get("MOTOR_AUTH_USER_INFO", ""),
    ".AspNetCore.Cookies": os.environ.get("MOTOR_ASPNETCORE_COOKIES", ""),
    "SessionIdentifier": os.environ.get("MOTOR_SESSION_IDENTIFIER", "")
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://sites.motor.com/m1/vehicles",
    "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin"
}

BASE_URL = "https://sites.motor.com/m1/api"

def get_json(url):
    try:
        response = requests.get(url, headers=HEADERS, cookies=COOKIES)
        if response.status_code == 200:
            return response.json()
        print(f"Failed to fetch {url}: {response.status_code}")
    except Exception as e:
        print(f"Error fetching {url}: {e}")
    return None

def extract():
    # Check if required environment variables are set
    missing_cookies = [k for k, v in COOKIES.items() if not v]
    if missing_cookies:
        print(f"Error: Missing required environment variables for cookies: {', '.join(missing_cookies)}")
        print("Please set MOTOR_UI_USER_SETTINGS, MOTOR_AUTH_USER_INFO, MOTOR_ASPNETCORE_COOKIES, and MOTOR_SESSION_IDENTIFIER.")
        return

    results = []
    
    # 1. Get all makes for YEAR
    print(f"Fetching makes for {YEAR}...")
    makes_data = get_json(f"{BASE_URL}/year/{YEAR}/makes")
    if not makes_data or 'body' not in makes_data:
        print("No makes data found.")
        return
    
    available_makes = {m['makeName']: m for m in makes_data['body']}
    
    for make_name in DIVERSE_MAKES:
        if make_name not in available_makes:
            print(f"Make {make_name} not found in {YEAR} data. Skipping.")
            continue
            
        print(f"\nProcessing {make_name}...")
        
        # 2. Get models
        models_data = get_json(f"{BASE_URL}/year/{YEAR}/make/{requests.utils.quote(make_name)}/models")
        if not models_data or 'body' not in models_data or not models_data['body']['models']:
            print(f"No models found for {make_name}.")
            continue
            
        content_source = models_data['body'].get('contentSource', 'MOTOR')
        model = models_data['body']['models'][0]
        # DEBUG: Print model structure
        print(f"Content Source: {content_source}, Model keys: {list(model.keys())}")
        
        # Support both 'engines' at top level or nested if changed
        vehicle_id = None
        if 'engines' in model and model['engines']:
            vehicle_id = model['engines'][0]['id']
        elif 'id' in model: # Check if model itself has the ID in 2020
            vehicle_id = model['id']
            
        if not vehicle_id:
            print(f"Could not find vehicle ID for {make_name} {model.get('model')}.")
            continue
            
        print(f"Found vehicle: {make_name} {model.get('model')} (ID: {vehicle_id})")
        
        # Helper to format URL with source
        def get_source_url(endpoint):
             # URL already has /api, we need /source/{source}/vehicle/{vid}/...
             # OR /source/{source}/{vid}/... depending on endpoint
             # The name endpoint uses /source/{source}/{vid}/name
             # The articles endpoint uses /source/{source}/vehicle/{vid}/articles/v2
             if 'articles/v2' in endpoint or 'parts' in endpoint:
                 return f"{BASE_URL}/source/{content_source}/vehicle/{requests.utils.quote(vehicle_id)}/{endpoint}"
             return f"{BASE_URL}/source/{content_source}/{requests.utils.quote(vehicle_id)}/{endpoint}"

        # 3. Get Articles (Buckets and first page of details)
        articles_data = get_json(get_source_url("articles/v2?searchTerm="))
        
        # 4. Get Parts
        parts_data = get_json(get_source_url("parts"))
        
        # 5. Get a Spec Sample (Engine Oil if exists)
        spec_content = None
        if articles_data and 'body' in articles_data:
            details = articles_data['body'].get('articleDetails', [])
            oil_spec = next((a for a in details if "Engine Oil Specifications" in a.get('title', '')), None)
            if oil_spec:
                print(f"Fetching content for '{oil_spec['title']}'...")
                # Spec content uses /article/{id}
                spec_url = f"{BASE_URL}/source/{content_source}/vehicle/{requests.utils.quote(vehicle_id)}/article/{requests.utils.quote(oil_spec['id'])}?bucketName=Specifications"
                spec_res = get_json(spec_url)
                if spec_res and 'body' in spec_res:
                    spec_content = spec_res['body'].get('html')

        # Collate
        vehicle_result = {
            "make": make_name,
            "model": model['model'],
            "vehicleId": vehicle_id,
            "filterTabs": articles_data['body'].get('filterTabs') if articles_data and 'body' in articles_data else None,
            "articlesSample": articles_data['body'].get('articleDetails')[:10] if articles_data and 'body' in articles_data else None,
            "partsSample": parts_data['body']['parts'][:5] if parts_data and 'body' in parts_data and 'parts' in parts_data['body'] else None,
            "engineOilSpec": spec_content
        }
        results.append(vehicle_result)
        
        # Sleep to avoid rate limiting
        time.sleep(1)

    # Save results
    with open('extracted_motor_data_2020.json', 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved data for {len(results)} vehicles to extracted_motor_data_2020.json")

if __name__ == "__main__":
    extract()
