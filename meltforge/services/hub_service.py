"""
Meltano Hub Service - Provides complete catalog of 655+ extractors and 50+ loaders,
with live GitHub YAML schema resolution and local disk caching.
"""

import json
import httpx
from pathlib import Path
from typing import Dict, Any, List, Optional
from ruamel.yaml import YAML

yaml = YAML(typ="safe")
DATA_DIR = Path(__file__).parent.parent / "data"
CATALOG_FILE = DATA_DIR / "catalog.json"
SETTINGS_CACHE_DIR = DATA_DIR / "settings_cache"
SETTINGS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Curated rich default settings for the most critical databases & warehouses
CURATED_SETTINGS = {
    "tap-postgres": [
        {"name": "host", "label": "Host", "kind": "string", "placeholder": "localhost", "required": True},
        {"name": "port", "label": "Port", "kind": "integer", "value": 5432, "required": True},
        {"name": "database", "label": "Database Name", "kind": "string", "placeholder": "postgres", "required": True},
        {"name": "user", "label": "Username", "kind": "string", "placeholder": "postgres", "required": True},
        {"name": "password", "label": "Password", "kind": "password", "secret": True, "required": True},
        {"name": "default_replication_method", "label": "Replication Method", "kind": "options", "value": "INCREMENTAL", "options": ["INCREMENTAL", "FULL_TABLE", "LOG_BASED"]},
        {"name": "start_date", "label": "Start Date", "kind": "date_iso8601", "placeholder": "2024-01-01T00:00:00Z"}
    ],
    "tap-mysql": [
        {"name": "host", "label": "Host", "kind": "string", "placeholder": "127.0.0.1", "required": True},
        {"name": "port", "label": "Port", "kind": "integer", "value": 3306, "required": True},
        {"name": "database", "label": "Database", "kind": "string", "required": True},
        {"name": "user", "label": "Username", "kind": "string", "required": True},
        {"name": "password", "label": "Password", "kind": "password", "secret": True, "required": True},
        {"name": "start_date", "label": "Start Date", "kind": "date_iso8601", "placeholder": "2024-01-01T00:00:00Z"}
    ],
    "target-snowflake": [
        {"name": "account", "label": "Account", "kind": "string", "placeholder": "xy12345.us-east-1", "required": True},
        {"name": "username", "label": "Username", "kind": "string", "required": True},
        {"name": "password", "label": "Password", "kind": "password", "secret": True, "required": True},
        {"name": "database", "label": "Database", "kind": "string", "required": True},
        {"name": "warehouse", "label": "Warehouse", "kind": "string", "placeholder": "COMPUTE_WH", "required": True},
        {"name": "default_target_schema", "label": "Default Schema", "kind": "string", "value": "RAW"}
    ],
    "target-bigquery": [
        {"name": "project_id", "label": "GCP Project ID", "kind": "string", "required": True},
        {"name": "dataset_id", "label": "BigQuery Dataset", "kind": "string", "required": True},
        {"name": "credentials_json", "label": "Service Account JSON", "kind": "password", "secret": True, "required": True}
    ],
    "target-duckdb": [
        {"name": "filepath", "label": "DuckDB Filepath", "kind": "string", "value": "warehouse.duckdb", "required": True},
        {"name": "default_target_schema", "label": "Default Schema", "kind": "string", "value": "main"}
    ]
}


class MeltanoHubService:
    def __init__(self):
        self.catalog = self._load_catalog()

    def _load_catalog(self) -> Dict[str, List[Dict[str, Any]]]:
        if CATALOG_FILE.exists():
            try:
                with open(CATALOG_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"extractors": [], "loaders": []}

    async def list_plugins(self, plugin_type: str = "extractors", query: Optional[str] = None) -> List[Dict[str, Any]]:
        """Lists plugins from the full catalog of 655 taps and 50 targets."""
        plugins = self.catalog.get(plugin_type, [])
        if not query:
            # Put popular databases and warehouses first
            priority_order = [
                "tap-postgres", "tap-mysql", "tap-snowflake", "tap-salesforce",
                "tap-shopify", "tap-stripe", "tap-github", "tap-google-sheets",
                "tap-mongodb", "tap-mssql", "tap-oracle", "tap-s3-csv",
                "target-snowflake", "target-bigquery", "target-postgres",
                "target-duckdb", "target-redshift", "target-s3-csv", "target-clickhouse"
            ]
            def sort_key(p):
                name = p.get("name", "")
                if name in priority_order:
                    return (0, priority_order.index(name))
                return (1, p.get("label", ""))

            return sorted(plugins, key=sort_key)

        q = query.lower().strip()
        filtered = [
            p for p in plugins
            if q in p.get("name", "").lower()
            or q in p.get("label", "").lower()
            or q in p.get("category", "").lower()
        ]
        return filtered

    async def get_plugin_details(
        self,
        plugin_type: str,
        plugin_name: str,
        variant: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetches the complete settings schema for ANY tap or target.
        Tries local cache, then GitHub YAML, then sensible category defaults.
        """
        # 1. Check disk settings cache
        cache_file = SETTINGS_CACHE_DIR / f"{plugin_type}_{plugin_name}.json"
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass

        # Find plugin metadata in catalog
        plugins = self.catalog.get(plugin_type, [])
        plugin_meta = next((p for p in plugins if p.get("name") == plugin_name), None)

        if not plugin_meta:
            plugin_meta = {
                "name": plugin_name,
                "label": plugin_name.replace("tap-", "").replace("target-", "").title(),
                "category": "Custom",
                "variants": [variant or "meltanolabs"],
                "default_variant": variant or "meltanolabs",
                "logo_url": f"https://hub.meltano.com/assets/logos/{plugin_type}/{plugin_name}.png",
                "description": f"Singer {plugin_type[:-1]} for {plugin_name}"
            }

        target_variant = variant or plugin_meta.get("default_variant") or "meltanolabs"

        # Check curated settings first
        if plugin_name in CURATED_SETTINGS:
            settings = CURATED_SETTINGS[plugin_name]
            result = {**plugin_meta, "variant": target_variant, "settings": settings}
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
            return result

        # 2. Fetch live settings YAML from GitHub
        settings = []
        pip_url = plugin_name
        try:
            url = f"https://raw.githubusercontent.com/meltano/hub/main/_data/meltano/{plugin_type}/{plugin_name}/{target_variant}.yml"
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    raw_data = yaml.load(resp.text) or {}
                    pip_url = raw_data.get("pip_url", plugin_name)
                    raw_settings = raw_data.get("settings", [])
                    for s in raw_settings:
                        s_name = s.get("name", "")
                        s_kind = s.get("kind", "string")
                        is_secret = (
                            s_kind == "password"
                            or any(k in s_name.lower() for k in ["password", "token", "key", "secret", "auth", "credential"])
                        )
                        settings.append({
                            "name": s_name,
                            "label": s.get("label") or s_name.replace("_", " ").title(),
                            "kind": s_kind,
                            "description": s.get("description", ""),
                            "value": s.get("value"),
                            "secret": is_secret,
                            "options": [opt.get("label", opt) if isinstance(opt, dict) else str(opt) for opt in s.get("options", [])] if s.get("options") else None
                        })
        except Exception:
            pass

        # 3. Fallback: Generate intelligent fields based on plugin name / category
        if not settings:
            name_lower = plugin_name.lower()
            if any(k in name_lower for k in ["postgres", "mysql", "mssql", "oracle", "db", "sql"]):
                settings = [
                    {"name": "host", "label": "Host", "kind": "string", "placeholder": "localhost", "required": True},
                    {"name": "port", "label": "Port", "kind": "integer", "value": 5432 if "postgres" in name_lower else 3306},
                    {"name": "database", "label": "Database", "kind": "string", "required": True},
                    {"name": "user", "label": "Username", "kind": "string", "required": True},
                    {"name": "password", "label": "Password", "kind": "password", "secret": True, "required": True}
                ]
            elif any(k in name_lower for k in ["s3", "gcs", "azure", "blob", "file"]):
                settings = [
                    {"name": "bucket", "label": "Bucket Name", "kind": "string", "required": True},
                    {"name": "aws_access_key_id", "label": "Access Key ID", "kind": "string"},
                    {"name": "aws_secret_access_key", "label": "Secret Access Key", "kind": "password", "secret": True}
                ]
            else:
                settings = [
                    {"name": "api_key", "label": "API Key / Token", "kind": "password", "secret": True, "required": True},
                    {"name": "start_date", "label": "Start Date", "kind": "date_iso8601", "placeholder": "2024-01-01T00:00:00Z"}
                ]

        result = {
            **plugin_meta,
            "variant": target_variant,
            "pip_url": pip_url,
            "settings": settings
        }

        # Cache result to disk
        try:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        except Exception:
            pass

        return result
