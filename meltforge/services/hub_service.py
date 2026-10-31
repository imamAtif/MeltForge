"""
Meltano Hub Service - Manages catalog indexing, live synchronization from Meltano Hub / GitHub,
and schema resolution for Singer taps and targets.
"""

import json
import time
import httpx
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional
from ruamel.yaml import YAML

yaml = YAML(typ="safe")
DATA_DIR = Path(__file__).parent.parent / "data"
CATALOG_FILE = DATA_DIR / "catalog.json"
META_FILE = DATA_DIR / "catalog_meta.json"
SETTINGS_CACHE_DIR = DATA_DIR / "settings_cache"

DATA_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

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
        self.meta = self._load_meta()

    def _load_catalog(self) -> Dict[str, List[Dict[str, Any]]]:
        if CATALOG_FILE.exists():
            try:
                with open(CATALOG_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"extractors": [], "loaders": []}

    def _load_meta(self) -> Dict[str, Any]:
        if META_FILE.exists():
            try:
                with open(META_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "last_synced_extractors": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "last_synced_loaders": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        }

    def _save_meta(self):
        try:
            with open(META_FILE, "w", encoding="utf-8") as f:
                json.dump(self.meta, f, indent=2)
        except Exception:
            pass

    def get_status(self) -> Dict[str, Any]:
        return {
            "extractors_count": len(self.catalog.get("extractors", [])),
            "loaders_count": len(self.catalog.get("loaders", [])),
            "last_synced_extractors": self.meta.get("last_synced_extractors", "Never"),
            "last_synced_loaders": self.meta.get("last_synced_loaders", "Never")
        }

    def _format_label(self, name: str, prefix: str) -> str:
        clean = name.replace(prefix, "").replace("singer-tap-", "")
        clean = clean.replace("-", " ").replace("_", " ")
        return clean.title()

    def _categorize(self, name: str) -> str:
        n = name.lower()
        if any(k in n for k in ["postgres", "mysql", "mssql", "oracle", "mongo", "dynamo", "redis", "couch", "sqlite", "mariadb", "cassandra"]):
            return "Databases"
        if any(k in n for k in ["snowflake", "bigquery", "redshift", "duckdb", "clickhouse", "athena", "databricks", "synapse", "dbt"]):
            return "Data Warehouses"
        if any(k in n for k in ["salesforce", "hubspot", "zendesk", "intercom", "pipedrive", "zoho", "freshdesk", "activecampaign"]):
            return "CRM & Support"
        if any(k in n for k in ["stripe", "paypal", "chargebee", "recharge", "xero", "quickbooks", "recurly", "braintree"]):
            return "Finance & Payments"
        if any(k in n for k in ["shopify", "woocommerce", "magento", "bigcommerce", "amazon", "ebay", "walmart"]):
            return "E-Commerce"
        if any(k in n for k in ["google", "facebook", "twitter", "linkedin", "tiktok", "bing", "adwords", "adroll", "adjust", "mixpanel", "amplitude", "segment"]):
            return "Marketing & Analytics"
        if any(k in n for k in ["github", "gitlab", "jira", "confluence", "linear", "pagerduty", "datadog", "sentry", "newrelic", "bitbucket"]):
            return "Developer Tools"
        if any(k in n for k in ["s3", "gcs", "azure", "blob", "sftp", "ftp", "box", "dropbox", "drive", "file", "csv", "json"]):
            return "Files & Storage"
        return "Apps & APIs"

    async def sync_plugins(self, plugin_type: str = "extractors") -> Dict[str, Any]:
        """
        Synchronizes the catalog for either extractors (taps) or loaders (targets)
        directly from the Meltano Hub official GitHub tree.
        """
        url = "https://api.github.com/repos/meltano/hub/git/trees/main?recursive=1"
        prefix = "_data/meltano/extractors/" if plugin_type == "extractors" else "_data/meltano/loaders/"
        name_prefix = "tap-" if plugin_type == "extractors" else "target-"

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers={"User-Agent": "MeltForge-Sync"})
            if resp.status_code != 200:
                raise Exception(f"Failed to fetch from GitHub (HTTP {resp.status_code})")
            tree_data = resp.json().get("tree", [])

        plugins_dict = {}
        for item in tree_data:
            path = item.get("path", "")
            if path.startswith(prefix) and path.endswith(".yml"):
                parts = path.split("/")
                name = parts[3]
                variant = parts[4][:-4]

                if name not in plugins_dict:
                    clean_icon = name.replace("tap-", "").replace("singer-tap-", "").replace("target-", "")
                    lbl = self._format_label(name, name_prefix)
                    plugins_dict[name] = {
                        "name": name,
                        "label": lbl,
                        "category": self._categorize(name),
                        "variants": [],
                        "default_variant": None,
                        "logo_url": f"https://hub.meltano.com/assets/logos/{plugin_type}/{clean_icon}.png",
                        "description": f"Extract data from {lbl}" if plugin_type == "extractors" else f"Load data into {lbl}"
                    }
                plugins_dict[name]["variants"].append(variant)

        # Set preferred default variant
        for p in plugins_dict.values():
            for preferred in ["meltanolabs", "transferwise", "singer-io", "airbyte", "matatika", "jwills", "datamill-co"]:
                if preferred in p["variants"]:
                    p["default_variant"] = preferred
                    break
            if not p["default_variant"] and p["variants"]:
                p["default_variant"] = p["variants"][0]

        new_list = list(plugins_dict.values())
        self.catalog[plugin_type] = new_list

        # Write to disk
        with open(CATALOG_FILE, "w", encoding="utf-8") as f:
            json.dump(self.catalog, f, indent=2)

        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        self.meta[f"last_synced_{plugin_type}"] = now_str
        self._save_meta()

        return {
            "success": True,
            "plugin_type": plugin_type,
            "count": len(new_list),
            "last_synced": now_str,
            "message": f"Successfully synchronized {len(new_list)} {plugin_type} from Meltano Hub."
        }

    async def list_plugins(self, plugin_type: str = "extractors", query: Optional[str] = None) -> List[Dict[str, Any]]:
        plugins = self.catalog.get(plugin_type, [])
        if not query:
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
        return [
            p for p in plugins
            if q in p.get("name", "").lower()
            or q in p.get("label", "").lower()
            or q in p.get("category", "").lower()
        ]

    async def get_plugin_details(
        self,
        plugin_type: str,
        plugin_name: str,
        variant: Optional[str] = None
    ) -> Dict[str, Any]:
        cache_file = SETTINGS_CACHE_DIR / f"{plugin_type}_{plugin_name}.json"
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass

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

        if plugin_name in CURATED_SETTINGS:
            settings = CURATED_SETTINGS[plugin_name]
            result = {**plugin_meta, "variant": target_variant, "settings": settings}
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
            return result

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

        try:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        except Exception:
            pass

        return result
