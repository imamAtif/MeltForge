"""
Meltano Hub Service - Fetches, searches, and provides schemas for extractors and loaders.
Includes curated fast offline defaults + live GitHub/Hub fetching with caching.
"""

import httpx
import asyncio
from typing import Dict, Any, List, Optional
from ruamel.yaml import YAML

yaml = YAML(typ="safe")

# Curated high-performance default catalog for instant offline/zero-latency startup
POPULAR_EXTRACTORS = [
    {
        "name": "tap-postgres",
        "label": "PostgreSQL",
        "description": "Extract data from PostgreSQL databases with full-table, incremental, or CDC log-based sync.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/postgres.png",
        "pip_url": "meltanolabs-tap-postgres",
        "variant": "meltanolabs",
        "category": "Databases",
        "settings": [
            {"name": "host", "label": "Host", "kind": "string", "description": "Database hostname or IP address", "placeholder": "localhost", "required": True},
            {"name": "port", "label": "Port", "kind": "integer", "description": "Database port number", "value": 5432, "required": True},
            {"name": "database", "label": "Database Name", "kind": "string", "description": "Name of the target database", "placeholder": "production_db", "required": True},
            {"name": "user", "label": "Username", "kind": "string", "description": "Database user with read permissions", "placeholder": "postgres", "required": True},
            {"name": "password", "label": "Password", "kind": "password", "description": "Database user password (stored in .env)", "required": True, "secret": True},
            {"name": "default_replication_method", "label": "Replication Method", "kind": "options", "description": "Replication strategy", "value": "INCREMENTAL", "options": ["INCREMENTAL", "FULL_TABLE", "LOG_BASED"]},
            {"name": "start_date", "label": "Start Date", "kind": "date_iso8601", "description": "Earliest record date to extract (e.g. 2024-01-01T00:00:00Z)", "placeholder": "2024-01-01T00:00:00Z"}
        ]
    },
    {
        "name": "tap-mysql",
        "label": "MySQL",
        "description": "Extract tables and change data from MySQL and MariaDB databases.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/mysql.png",
        "pip_url": "meltanolabs-tap-mysql",
        "variant": "meltanolabs",
        "category": "Databases",
        "settings": [
            {"name": "host", "label": "Host", "kind": "string", "description": "MySQL hostname", "placeholder": "127.0.0.1", "required": True},
            {"name": "port", "label": "Port", "kind": "integer", "description": "MySQL port", "value": 3306, "required": True},
            {"name": "database", "label": "Database", "kind": "string", "description": "MySQL database name", "required": True},
            {"name": "user", "label": "User", "kind": "string", "description": "Database user", "required": True},
            {"name": "password", "label": "Password", "kind": "password", "description": "Password (saved in .env)", "required": True, "secret": True},
            {"name": "start_date", "label": "Start Date", "kind": "date_iso8601", "description": "Initial replication timestamp", "placeholder": "2024-01-01T00:00:00Z"}
        ]
    },
    {
        "name": "tap-snowflake",
        "label": "Snowflake",
        "description": "Extract tables, views, and schemas from Snowflake data warehouse.",
        "logo_url": "https://hub.meltano.com/assets/logos/loaders/snowflake.png",
        "pip_url": "meltanolabs-tap-snowflake",
        "variant": "meltanolabs",
        "category": "Warehouses",
        "settings": [
            {"name": "account", "label": "Account Identifier", "kind": "string", "description": "e.g. xy12345.us-east-1", "required": True},
            {"name": "username", "label": "User", "kind": "string", "description": "Snowflake user", "required": True},
            {"name": "password", "label": "Password", "kind": "password", "description": "Password (saved in .env)", "required": True, "secret": True},
            {"name": "database", "label": "Database", "kind": "string", "description": "Snowflake database name", "required": True},
            {"name": "schema", "label": "Schema", "kind": "string", "description": "Snowflake schema", "value": "PUBLIC"},
            {"name": "warehouse", "label": "Warehouse", "kind": "string", "description": "Compute warehouse to use", "placeholder": "COMPUTE_WH"}
        ]
    },
    {
        "name": "tap-google-sheets",
        "label": "Google Sheets",
        "description": "Extract tabs and ranges from Google Sheets spreadsheets.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/google-sheets.png",
        "pip_url": "meltanolabs-tap-google-sheets",
        "variant": "meltanolabs",
        "category": "Apps & SaaS",
        "settings": [
            {"name": "spreadsheet_id", "label": "Spreadsheet ID", "kind": "string", "description": "The Google Sheets ID found in the URL", "required": True},
            {"name": "credentials_json", "label": "Service Account JSON", "kind": "password", "description": "Raw Google Service Account JSON credentials (saved in .env)", "required": True, "secret": True}
        ]
    },
    {
        "name": "tap-salesforce",
        "label": "Salesforce",
        "description": "Extract accounts, leads, opportunities, and custom CRM objects from Salesforce.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/salesforce.png",
        "pip_url": "meltanolabs-tap-salesforce",
        "variant": "meltanolabs",
        "category": "Apps & SaaS",
        "settings": [
            {"name": "client_id", "label": "Client ID", "kind": "string", "description": "Connected App Client ID", "required": True},
            {"name": "client_secret", "label": "Client Secret", "kind": "password", "description": "Connected App Secret", "required": True, "secret": True},
            {"name": "refresh_token", "label": "Refresh Token", "kind": "password", "description": "OAuth Refresh Token", "required": True, "secret": True},
            {"name": "start_date", "label": "Start Date", "kind": "date_iso8601", "description": "Start timestamp for sync", "placeholder": "2024-01-01T00:00:00Z"}
        ]
    },
    {
        "name": "tap-stripe",
        "label": "Stripe",
        "description": "Extract charges, customers, invoices, subscriptions, and payouts from Stripe Payments.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/stripe.png",
        "pip_url": "meltanolabs-tap-stripe",
        "variant": "meltanolabs",
        "category": "Finance",
        "settings": [
            {"name": "client_secret", "label": "Stripe Restricted API Key", "kind": "password", "description": "Stripe Secret or Restricted Key (rk_live_...)", "required": True, "secret": True},
            {"name": "start_date", "label": "Start Date", "kind": "date_iso8601", "description": "Historical sync start date", "placeholder": "2024-01-01T00:00:00Z", "required": True}
        ]
    },
    {
        "name": "tap-github",
        "label": "GitHub",
        "description": "Extract repositories, commits, pull requests, issues, and workflow runs from GitHub.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/github.png",
        "pip_url": "meltanolabs-tap-github",
        "variant": "meltanolabs",
        "category": "Developer Tools",
        "settings": [
            {"name": "auth_token", "label": "GitHub Personal Access Token", "kind": "password", "description": "GitHub PAT (classic or fine-grained)", "required": True, "secret": True},
            {"name": "repositories", "label": "Repositories", "kind": "string", "description": "Comma-separated list (e.g. owner/repo)", "placeholder": "meltano/meltano", "required": True},
            {"name": "start_date", "label": "Start Date", "kind": "date_iso8601", "description": "Sync from date", "placeholder": "2024-01-01T00:00:00Z"}
        ]
    },
    {
        "name": "tap-mongodb",
        "label": "MongoDB",
        "description": "Extract documents and collections from MongoDB databases.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/mongodb.png",
        "pip_url": "meltanolabs-tap-mongodb",
        "variant": "meltanolabs",
        "category": "Databases",
        "settings": [
            {"name": "connection_string", "label": "Connection URI", "kind": "password", "description": "mongodb+srv://user:pass@cluster.mongodb.net/dbname", "required": True, "secret": True},
            {"name": "database", "label": "Database Name", "kind": "string", "description": "Default MongoDB database", "required": True}
        ]
    },
    {
        "name": "tap-s3-csv",
        "label": "AWS S3 (CSV)",
        "description": "Extract and parse CSV and delimited data files from Amazon S3 buckets.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/aws-s3.png",
        "pip_url": "meltanolabs-tap-s3-csv",
        "variant": "meltanolabs",
        "category": "File Storage",
        "settings": [
            {"name": "bucket", "label": "S3 Bucket", "kind": "string", "description": "AWS S3 bucket name", "required": True},
            {"name": "aws_access_key_id", "label": "AWS Access Key", "kind": "string", "description": "AWS Access Key ID", "required": True},
            {"name": "aws_secret_access_key", "label": "AWS Secret Key", "kind": "password", "description": "AWS Secret Access Key", "required": True, "secret": True},
            {"name": "start_date", "label": "Start Date", "kind": "date_iso8601", "description": "Sync files modified after", "placeholder": "2024-01-01T00:00:00Z"}
        ]
    }
]

POPULAR_LOADERS = [
    {
        "name": "target-snowflake",
        "label": "Snowflake",
        "description": "Load structured tables and JSON streams directly into Snowflake data warehouse.",
        "logo_url": "https://hub.meltano.com/assets/logos/loaders/snowflake.png",
        "pip_url": "meltanolabs-target-snowflake",
        "variant": "meltanolabs",
        "category": "Warehouses",
        "settings": [
            {"name": "account", "label": "Snowflake Account", "kind": "string", "description": "Account identifier (e.g. xy12345.us-east-1)", "required": True},
            {"name": "username", "label": "User", "kind": "string", "description": "Snowflake username", "required": True},
            {"name": "password", "label": "Password", "kind": "password", "description": "User password (saved in .env)", "required": True, "secret": True},
            {"name": "database", "label": "Target Database", "kind": "string", "description": "Destination database", "required": True},
            {"name": "default_target_schema", "label": "Target Schema", "kind": "string", "description": "Target schema name", "value": "RAW"},
            {"name": "warehouse", "label": "Compute Warehouse", "kind": "string", "description": "Warehouse for loading", "placeholder": "COMPUTE_WH", "required": True}
        ]
    },
    {
        "name": "target-postgres",
        "label": "PostgreSQL",
        "description": "Load data tables and updates into any PostgreSQL, Supabase, or RDS instance.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/postgres.png",
        "pip_url": "meltanolabs-target-postgres",
        "variant": "meltanolabs",
        "category": "Databases",
        "settings": [
            {"name": "host", "label": "Host", "kind": "string", "description": "Postgres hostname", "placeholder": "localhost", "required": True},
            {"name": "port", "label": "Port", "kind": "integer", "description": "Postgres port", "value": 5432, "required": True},
            {"name": "database", "label": "Database", "kind": "string", "description": "Target database", "required": True},
            {"name": "user", "label": "Username", "kind": "string", "description": "Database user", "required": True},
            {"name": "password", "label": "Password", "kind": "password", "description": "User password (saved in .env)", "required": True, "secret": True},
            {"name": "default_target_schema", "label": "Schema", "kind": "string", "description": "Destination schema", "value": "public"}
        ]
    },
    {
        "name": "target-bigquery",
        "label": "Google BigQuery",
        "description": "Load streaming and batch records into Google Cloud BigQuery datasets.",
        "logo_url": "https://hub.meltano.com/assets/logos/loaders/google-bigquery.png",
        "pip_url": "meltanolabs-target-bigquery",
        "variant": "meltanolabs",
        "category": "Warehouses",
        "settings": [
            {"name": "project_id", "label": "GCP Project ID", "kind": "string", "description": "Google Cloud project ID", "required": True},
            {"name": "dataset_id", "label": "BigQuery Dataset", "kind": "string", "description": "Target dataset name", "required": True},
            {"name": "credentials_json", "label": "Service Account JSON", "kind": "password", "description": "Raw GCP Service Account JSON (saved in .env)", "required": True, "secret": True}
        ]
    },
    {
        "name": "target-duckdb",
        "label": "DuckDB",
        "description": "Load data into high-speed embedded DuckDB files for local analytics and pipelines.",
        "logo_url": "https://hub.meltano.com/assets/logos/loaders/duckdb.png",
        "pip_url": "target-duckdb",
        "variant": "jwills",
        "category": "Embedded / Local",
        "settings": [
            {"name": "filepath", "label": "DuckDB File Path", "kind": "string", "description": "Path to local .duckdb database file", "value": "warehouse.duckdb", "required": True},
            {"name": "default_target_schema", "label": "Schema", "kind": "string", "description": "Schema name", "value": "main"}
        ]
    },
    {
        "name": "target-s3-csv",
        "label": "AWS S3 (Data Lake)",
        "description": "Dump data records as partitioned CSV/Parquet objects into an S3 bucket.",
        "logo_url": "https://hub.meltano.com/assets/logos/extractors/aws-s3.png",
        "pip_url": "meltanolabs-target-s3-csv",
        "variant": "meltanolabs",
        "category": "File Storage",
        "settings": [
            {"name": "s3_bucket", "label": "S3 Bucket", "kind": "string", "description": "Target AWS S3 bucket", "required": True},
            {"name": "aws_access_key_id", "label": "Access Key ID", "kind": "string", "description": "AWS Access Key", "required": True},
            {"name": "aws_secret_access_key", "label": "Secret Access Key", "kind": "password", "description": "AWS Secret Key (saved in .env)", "required": True, "secret": True}
        ]
    },
    {
        "name": "target-jsonl",
        "label": "JSON Lines (File / Local)",
        "description": "Lightweight destination that writes records to local JSONL files for inspection & debugging.",
        "logo_url": "https://hub.meltano.com/assets/logos/loaders/jsonl.png",
        "pip_url": "target-jsonl",
        "variant": "andyh1203",
        "category": "Embedded / Local",
        "settings": [
            {"name": "destination_path", "label": "Output Directory", "kind": "string", "description": "Local path for output files", "value": "output", "required": True}
        ]
    }
]


class MeltanoHubService:
    def __init__(self):
        self._cache: Dict[str, Any] = {}
        self._last_fetch = 0

    async def list_plugins(self, plugin_type: str = "extractors", query: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns list of plugins matching query, prioritizing curated defaults."""
        defaults = POPULAR_EXTRACTORS if plugin_type == "extractors" else POPULAR_LOADERS
        
        # Format results
        results = list(defaults)

        # Apply search query if provided
        if query:
            q = query.lower().strip()
            results = [
                p for p in results
                if q in p["name"].lower() or q in p["label"].lower() or q in p.get("description", "").lower()
            ]

        return results

    async def get_plugin_details(self, plugin_type: str, plugin_name: str, variant: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieves complete settings schema for a specific plugin."""
        defaults = POPULAR_EXTRACTORS if plugin_type == "extractors" else POPULAR_LOADERS
        found = next((p for p in defaults if p["name"] == plugin_name), None)
        if found:
            return dict(found)

        # Fallback: Try fetching raw manifest from Meltano GitHub repository
        try:
            var = variant or "meltanolabs"
            url = f"https://raw.githubusercontent.com/meltano/hub/main/_data/meltano/{plugin_type}/{plugin_name}/{var}.yml"
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    raw_data = yaml.load(resp.text)
                    settings = []
                    for s in raw_data.get("settings", []):
                        name = s.get("name", "")
                        kind = s.get("kind", "string")
                        is_secret = (
                            kind == "password"
                            or any(term in name.lower() for term in ["password", "token", "key", "secret", "credentials"])
                        )
                        settings.append({
                            "name": name,
                            "label": s.get("label", name.replace("_", " ").title()),
                            "kind": kind,
                            "description": s.get("description", ""),
                            "value": s.get("value"),
                            "secret": is_secret
                        })
                    
                    logo = raw_data.get("logo_url", "")
                    if logo.startswith("/"):
                        logo = f"https://hub.meltano.com{logo}"

                    return {
                        "name": plugin_name,
                        "label": raw_data.get("label", plugin_name),
                        "description": raw_data.get("description", ""),
                        "logo_url": logo,
                        "pip_url": raw_data.get("pip_url", plugin_name),
                        "variant": var,
                        "category": "Community",
                        "settings": settings
                    }
        except Exception:
            pass

        # If not found anywhere, return a generic plugin template
        return {
            "name": plugin_name,
            "label": plugin_name.replace("tap-", "").replace("target-", "").title(),
            "description": f"Custom Singer {plugin_type[:-1]} {plugin_name}",
            "logo_url": "",
            "pip_url": plugin_name,
            "variant": variant or "default",
            "category": "Custom",
            "settings": []
        }
