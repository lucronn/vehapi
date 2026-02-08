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

# Session Info (Extracted from HAR data)
COOKIES = {
    "UIUserSettings": "%7B%22userId%22%3A%22ns238476%22%2C%22isCcc%22%3Afalse%2C%22enableMotorVehicleModel%22%3Atrue%2C%22pageTitle%22%3A%22Auto%20RepairSource_Powered%20by%20MOTOR%22%2C%22splashUrl%22%3A%22api%2Fasset%2F3f9e9e79-b9c1-4586-91b8-94fe68174f7e%22%2C%22ymmeSelectorMode%22%3A%22Link%22%2C%22hamburgerMenuMode%22%3A%22Enabled%22%2C%22ymmeVinSearchMode%22%3A%22Enabled%22%2C%22recentVehiclesMode%22%3A%22Enabled%22%2C%22recentVehiclesCount%22%3A%2210%22%2C%22loginType%22%3A%22SharedKey%22%2C%22sessionExpirationRedirectURL%22%3A%22%22%2C%22oemLicenseAgreement%22%3A%22Enabled%22%2C%22apiUserLogoutMode%22%3A%22Disabled%22%2C%22apiUserLogoutLabel%22%3A%22Logout%22%2C%22apiUserRedirectionURL%22%3A%22%22%2C%22feedbackMode%22%3A%22Disabled%22%2C%22feedbackLabel%22%3A%22Feedback%22%2C%22lhNavigationDefaultMode%22%3A%22Collapsed%22%2C%22lhNavigationSiloDisplayMode%22%3A%22Show%22%2C%22lhNavigationSpecSiloDisplayMode%22%3A%22Show%22%2C%22printEnableHeader%22%3A%22%22%2C%22printBannerUrl%22%3A%22api%2Fasset%2Fa99274b9-6d81-419f-8f14-d5b913cd1a56%22%2C%22printBannerColor%22%3A%22%23002F56%22%2C%22printDisplayVehicleDetails%22%3A%22%22%2C%22navigateToVehicleDeltaReport%22%3Afalse%7D",
    "AuthUserInfo": "eyJQdWJsaWNLZXkiOiJTNWRGdXRvaVFnIiwiQXBpVG9rZW5LZXkiOiJldFMxSCIsIkFwaVRva2VuVmFsdWUiOiJMaTdzMURyd3cyeXFIajJVMlV4S2Q1a25PIiwiQXBpVG9rZW5FeHBpcmF0aW9uIjoiMjAyNi0wMi0wMlQwMjoyMTowNVoiLCJMb2dvdXRVcmwiOiIvIiwiU3Vic2NyaXB0aW9ucyI6WyJUcnVTcGVlZCJdLCJVc2VyTmFtZSI6IlRydVNwZWVkVHJpYWxFQlNDTyIsIkZpcnN0TmFtZSI6IlRydVNwZWVkIFRyaWFsIiwiTGFzdE5hbWUiOiJFQlNDTyIsIkJ5cGFzc0lkZW50aXR5U2VydmVyIjp0cnVlfQ",
    ".AspNetCore.Cookies": "CfDJ8CS7VC-PkJNGignRlOslmrj9nwRdcG7NS3_BhTuKdIHfnCY99i4SszT3bUIfpytgC9PuZ61od83mPJ2y-h1ZVYHN1pjWo5NEWd9uz9KP65PUwJJIIK8ZMsk5UwKJGcR0Iz1xBW55KmAF9m0rOeuG8uaEQxWKm8R9NzSzhlBkbTCk2HeT2Wqpt8WJWy_r6_J4nt4vjTyhokQObeZ_EqXeul9Q7OzSJ40QpTwq5PDmTsMxiMmh6vosKYcUiPNcnLrkYbIubnp2PBIYQjfakdBSOYUga-hCDc05ZizYuyumM4cZOmnj3W6o_-HbgKIE37SkvtwnR68pz2dKKDA5TMHizNTvVbJj5xXHx_wN4UBzsV-r6NNLT7lQxdCoN05udTXydrEtE7ZkpVirnqpsIFCuVWJ0yUC2sRURuNanhpN9WY0va7o8SHI6061UuRoTFiNZBz3ebjwoE6hxA5VwhKU0hA3Emds4vxlbFsqNev1iPnaQUxBdDFi0OAO9TfavdOa8lacLHqMX7kmi3l5ZFj7k1gR9Ej6KxaIeD0PwmoDn8iZjZ9NVVzCRFtMgrMXbvt3XZgoCPpeD68wKn1gsMYelNMlRJTHDaoKkhTX-5WHVDl5NNlrrWykWvWM4sE0IsncrE0L14HqRxNPXlq1_Fx3w7AGUeKTIlMS02ZTNyEYcDFj9YW1iHRauUJP0BUYAuroq7MA0drJdfgwE4fKrzAHcvXWhU-LozJknJoAXPSgjOp2KA-ULm4KwwEq7A6P2yWBMhg",
    "SessionIdentifier": "f0cda6af-ca69-46a6-9a99-b247140db1a2"
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
