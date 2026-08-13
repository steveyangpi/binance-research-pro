#!/usr/bin/env python3
"""Validate the local Binance Research Pro package without external dependencies."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / ".codex-plugin" / "plugin.json"
MCP_CONFIG = ROOT / ".mcp.json"
EXPECTED_SKILLS = {
    "binance-market-research",
    "binance-derivatives-research",
    "binance-historical-research",
    "binance-risk-review",
}
MCP_PACKAGE = ROOT / "packages" / "mcp" / "package.json"
EXPECTED_ENV_VARS = {
    "BINANCE_RESEARCH_DATA_DIR",
    "BINANCE_REST_BASE_URL",
    "BINANCE_FUTURES_REST_BASE_URL",
    "BINANCE_REQUEST_TIMEOUT_MS",
    "BINANCE_CACHE_TTL_MS",
    "BINANCE_CANDLE_CACHE_TTL_MS",
    "BINANCE_FUNDING_CACHE_TTL_MS",
    "BINANCE_PERSISTENT_CACHE_ENABLED",
    "BINANCE_CACHE_DB_PATH",
    "BINANCE_CACHE_MAX_ENTRIES",
    "WAREHOUSE_ENABLED",
    "WAREHOUSE_PARQUET_ROOT",
    "WAREHOUSE_METADATA_DB_PATH",
    "WAREHOUSE_TEMP_DIR",
    "WAREHOUSE_IMPORT_ROOTS",
    "WAREHOUSE_MAX_IMPORT_BYTES",
    "WAREHOUSE_DOWNLOAD_TIMEOUT_MS",
}
REQUIRED_FILES = {
    ROOT / "README.md",
    ROOT / "README.zh-CN.md",
    ROOT / "CLAUDE.md",
    ROOT / "CODEX.md",
    ROOT / "docs" / "ARCHITECTURE.md",
    ROOT / "docs" / "ARCHITECTURE.zh-CN.md",
    ROOT / "docs" / "DEVELOPMENT.md",
    ROOT / "docs" / "DEVELOPMENT.zh-CN.md",
    ROOT / "docs" / "SECURITY.md",
    ROOT / "docs" / "SECURITY.zh-CN.md",
    ROOT / "docs" / "INSTALLATION.md",
    ROOT / "docs" / "INSTALLATION.zh-CN.md",
    ROOT / "docs" / "RELEASING.md",
    ROOT / "docs" / "RELEASING.zh-CN.md",
    ROOT / "docs" / "TESTING.md",
    ROOT / "docs" / "TESTING.zh-CN.md",
    ROOT / "docs" / "ROADMAP.md",
    ROOT / "docs" / "ROADMAP.zh-CN.md",
}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"Unable to read {path}: {error}")


def main() -> None:
    for path in {MANIFEST, MCP_CONFIG, MCP_PACKAGE, *REQUIRED_FILES}:
        if not path.is_file():
            fail(f"Missing required file: {path}")

    manifest = load_json(MANIFEST)
    if manifest.get("name") != "binance-research-pro":
        fail("Manifest name must be binance-research-pro")
    if not re.fullmatch(r"\d+\.\d+\.\d+\+codex\.\d{14}", manifest.get("version", "")):
        fail("Manifest version must use X.Y.Z+codex.YYYYMMDDHHmmss UTC metadata")
    if manifest.get("mcpServers") != "./.mcp.json":
        fail("Manifest must reference ./.mcp.json")
    if manifest.get("skills") != "./skills/":
        fail("Manifest must reference ./skills/")

    config = load_json(MCP_CONFIG)
    mcp_package = load_json(MCP_PACKAGE)
    package_name = mcp_package.get("name")
    servers = config.get("mcpServers")
    if not isinstance(servers, dict) or set(servers) != {"binance-research-pro"}:
        fail("MCP config must contain exactly one binance-research-pro server")
    server = servers["binance-research-pro"]
    if server.get("command") != "npx":
        fail("MCP server command must be npx")
    args = server.get("args")
    if not isinstance(args, list) or len(args) != 4:
        fail("MCP server must use the portable npx argument shape")
    package_argument = args[1] if len(args) > 1 else ""
    package_prefix = f"--package={package_name}@"
    pinned_version = package_argument.removeprefix(package_prefix)
    expected_args = ["-y", package_argument, "--", "binance-research-pro-mcp"]
    if args != expected_args or not package_argument.startswith(package_prefix):
        fail(f"MCP server must launch a fixed {package_name} package")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", pinned_version):
        fail("MCP package version must be fixed, not a tag or range")
    env_vars = server.get("env_vars")
    if not isinstance(env_vars, list) or set(env_vars) != EXPECTED_ENV_VARS:
        fail("MCP server must forward the documented optional environment variables")
    env = server.get("env", {})
    forbidden = {"BINANCE_API_KEY", "BINANCE_API_SECRET"}
    if forbidden.intersection(env) or forbidden.intersection(env_vars):
        fail("Phase 1 must not configure Binance credentials")

    skills = {
        path.parent.name
        for path in (ROOT / "skills").glob("*/SKILL.md")
        if path.is_file()
    }
    if skills != EXPECTED_SKILLS:
        fail(f"Unexpected skill set: {sorted(skills)}")

    print("Binance Research Pro package validation passed.")
    print(f"Manifest: {MANIFEST}")
    print(f"MCP source: {package_name}@{mcp_package.get('version')}")
    print(f"Plugin pin: {package_name}@{pinned_version}")
    print(f"Skills: {', '.join(sorted(skills))}")


if __name__ == "__main__":
    main()
