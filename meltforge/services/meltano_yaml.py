"""
Meltano YAML Service - Manages meltano.yml and .env safely.
Uses ruamel.yaml round-trip mode to preserve comments, formatting, and key order.
"""

from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from ruamel.yaml import YAML
import os
from dotenv import set_key, dotenv_values

yaml = YAML(typ="rt")
yaml.preserve_quotes = True
yaml.indent(mapping=2, sequence=4, offset=2)


def find_meltano_project_root(start_dir: Optional[Path] = None) -> Path:
    """Find the directory containing meltano.yml, ascending up to root."""
    current = (start_dir or Path.cwd()).resolve()
    for parent in [current, *current.parents]:
        if (parent / "meltano.yml").is_file():
            return parent
    return current


class MeltanoYamlService:
    def __init__(self, project_root: Optional[Path] = None):
        self.project_root = find_meltano_project_root(project_root)
        self.yaml_file = self.project_root / "meltano.yml"
        self.env_file = self.project_root / ".env"

    def is_initialized(self) -> bool:
        return self.yaml_file.is_file()

    def init_project(self, project_name: str = "meltforge-project") -> Dict[str, Any]:
        """Initializes a new standard meltano.yml if not existing."""
        if self.is_initialized():
            return self.read()

        default_content = f"""version: 1
default_environment: dev
project_id: {project_name}

environments:
  - name: dev
  - name: prod

plugins:
  extractors: []
  loaders: []

jobs: []
schedules: []
"""
        self.yaml_file.parent.mkdir(parents=True, exist_ok=True)
        self.yaml_file.write_text(default_content, encoding="utf-8")

        # Ensure .env and .gitignore exist
        if not self.env_file.exists():
            self.env_file.write_text("# Environment secrets for Meltano\n", encoding="utf-8")

        gitignore = self.project_root / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text(".meltano/\n.env\n__pycache__/\n*.pyc\n", encoding="utf-8")
        else:
            current_gi = gitignore.read_text(encoding="utf-8")
            to_add = []
            if ".meltano" not in current_gi:
                to_add.append(".meltano/")
            if ".env" not in current_gi:
                to_add.append(".env")
            if to_add:
                gitignore.write_text(current_gi.rstrip() + "\n" + "\n".join(to_add) + "\n", encoding="utf-8")

        return self.read()

    def read_raw(self) -> str:
        if not self.is_initialized():
            return ""
        return self.yaml_file.read_text(encoding="utf-8")

    def read(self) -> Dict[str, Any]:
        """Reads and parses meltano.yml into structured dict."""
        if not self.is_initialized():
            return {"initialized": False, "plugins": {"extractors": [], "loaders": []}, "jobs": []}

        with open(self.yaml_file, "r", encoding="utf-8") as f:
            data = yaml.load(f) or {}

        # Ensure plugins dictionary exists
        if "plugins" not in data or data["plugins"] is None:
            data["plugins"] = {}
        if "extractors" not in data["plugins"] or data["plugins"]["extractors"] is None:
            data["plugins"]["extractors"] = []
        if "loaders" not in data["plugins"] or data["plugins"]["loaders"] is None:
            data["plugins"]["loaders"] = []

        return data

    def write(self, data: Any) -> None:
        """Writes parsed data back into meltano.yml preserving comments."""
        with open(self.yaml_file, "w", encoding="utf-8") as f:
            yaml.dump(data, f)

    def get_secrets(self) -> Dict[str, str]:
        """Reads environment variables from .env file."""
        if not self.env_file.is_file():
            return {}
        return {k: v or "" for k, v in dotenv_values(self.env_file).items()}

    def set_secrets(self, secrets: Dict[str, str]) -> None:
        """Saves sensitive variables into .env."""
        if not self.env_file.exists():
            self.env_file.write_text("", encoding="utf-8")
        for key, value in secrets.items():
            if value is not None:
                set_key(str(self.env_file), key, str(value), quote_mode="always")

    def get_plugin(self, plugin_type: str, plugin_name: str) -> Optional[Dict[str, Any]]:
        """Finds a configured plugin in meltano.yml."""
        data = self.read()
        plugins = data.get("plugins", {}).get(plugin_type, [])
        for p in plugins:
            if p.get("name") == plugin_name:
                return dict(p)
        return None

    def upsert_plugin(
        self,
        plugin_type: str,  # 'extractors' or 'loaders'
        name: str,
        variant: Optional[str] = None,
        pip_url: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
        secrets: Optional[Dict[str, str]] = None,
        select: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Adds or updates a plugin in meltano.yml.
        Splits public config into meltano.yml and secrets into .env.
        """
        data = self.read()
        if "plugins" not in data:
            data["plugins"] = {}
        if plugin_type not in data["plugins"]:
            data["plugins"][plugin_type] = []

        target_list = data["plugins"][plugin_type]
        existing = next((p for p in target_list if p.get("name") == name), None)

        if existing is None:
            new_plugin = {"name": name}
            if variant:
                new_plugin["variant"] = variant
            if pip_url:
                new_plugin["pip_url"] = pip_url
            if config:
                new_plugin["config"] = config
            if select and plugin_type == "extractors":
                new_plugin["select"] = select
            target_list.append(new_plugin)
        else:
            if variant:
                existing["variant"] = variant
            if pip_url:
                existing["pip_url"] = pip_url
            if config is not None:
                if "config" not in existing or not isinstance(existing["config"], dict):
                    existing["config"] = {}
                existing["config"].update(config)
            if select is not None and plugin_type == "extractors":
                existing["select"] = select

        self.write(data)

        # Handle secrets in .env
        if secrets:
            env_secrets = {}
            for k, v in secrets.items():
                if v:
                    # Meltano secret convention: <PLUGIN_NAME>_<SETTING_NAME> capitalized
                    env_key = f"{name.upper().replace('-', '_')}_{k.upper().replace('.', '_')}"
                    env_secrets[env_key] = v
            self.set_secrets(env_secrets)

        return self.read()

    def remove_plugin(self, plugin_type: str, name: str) -> Dict[str, Any]:
        """Removes a plugin from meltano.yml."""
        data = self.read()
        if "plugins" in data and plugin_type in data["plugins"]:
            data["plugins"][plugin_type] = [
                p for p in data["plugins"][plugin_type] if p.get("name") != name
            ]
            self.write(data)
        return self.read()

    def get_pipelines(self) -> List[Dict[str, Any]]:
        """
        Returns pairs of extractors and loaders or defined jobs.
        If explicit jobs/schedules exist, uses them. Otherwise derives from configured plugins.
        """
        data = self.read()
        jobs = data.get("jobs", []) or []
        pipelines = []

        extractors = data.get("plugins", {}).get("extractors", []) or []
        loaders = data.get("plugins", {}).get("loaders", []) or []

        # Return explicit jobs
        for j in jobs:
            tasks = j.get("tasks", [])
            pipelines.append({
                "id": j.get("name"),
                "name": j.get("name"),
                "type": "job",
                "tasks": tasks,
                "is_configured": True
            })

        # Also return active extractor + loader pairs if no jobs defined
        if not pipelines and extractors and loaders:
            for ext in extractors:
                for ldr in loaders:
                    pipe_id = f"{ext.get('name')}-to-{ldr.get('name')}"
                    pipelines.append({
                        "id": pipe_id,
                        "name": f"{ext.get('name')} ➔ {ldr.get('name')}",
                        "extractor": ext.get("name"),
                        "loader": ldr.get("name"),
                        "type": "pair",
                        "tasks": [f"{ext.get('name')} {ldr.get('name')}"],
                        "is_configured": True
                    })

        return pipelines
