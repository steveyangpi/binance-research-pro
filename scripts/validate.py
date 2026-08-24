#!/usr/bin/env python3
"""Validate the local Binance Research Pro plugin deliverables without dependencies."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CODEX_MANIFEST = ROOT / ".codex-plugin" / "plugin.json"
CLAUDE_MANIFEST = ROOT / ".claude-plugin" / "plugin.json"
CODEX_MCP_CONFIG = ROOT / ".mcp.json"
CLAUDE_MCP_CONFIG = ROOT / "claude.mcp.json"
EXPECTED_SKILLS = {
    "binance-account-research",
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
    "BINANCE_ACCOUNT_PROFILES_PATH",
    "BINANCE_ACCOUNT_RECV_WINDOW_MS",
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
FORBIDDEN_ENV_VARS = {"BINANCE_API_KEY", "BINANCE_API_SECRET"}
REQUIRED_FILES = {
    ROOT / "README.md",
    ROOT / "README.zh-CN.md",
    ROOT / "CLAUDE.md",
    ROOT / "CODEX.md",
    ROOT / "docs" / "ARCHITECTURE.md",
    ROOT / "docs" / "ARCHITECTURE.zh-CN.md",
    ROOT / "docs" / "ACCOUNT-ACCESS.md",
    ROOT / "docs" / "ACCOUNT-ACCESS.zh-CN.md",
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


def validate_mcp_config(config: dict, package_name: str, *, codex: bool) -> str:
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
    expected_args = ["-y", package_argument, "--", "binance-research-pro-mcp"]
    if args != expected_args or not package_argument.startswith(package_prefix):
        fail(f"MCP server must launch a fixed {package_name} package")

    pinned_version = package_argument.removeprefix(package_prefix)
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", pinned_version):
        fail("MCP package version must be fixed, not a tag or range")

    env_vars = server.get("env_vars")
    if codex:
        if not isinstance(env_vars, list) or set(env_vars) != EXPECTED_ENV_VARS:
            fail("Codex MCP config must forward the documented optional environment variables")
    elif env_vars is not None:
        fail("Claude MCP config must not use Codex-only env_vars")

    env = server.get("env", {})
    if not isinstance(env, dict):
        fail("MCP server env must be an object when configured")
    if FORBIDDEN_ENV_VARS.intersection(env) or (
        isinstance(env_vars, list) and FORBIDDEN_ENV_VARS.intersection(env_vars)
    ):
        fail("Credential values must not be configured directly in an MCP manifest")

    return pinned_version


def main() -> None:
    for path in {
        CODEX_MANIFEST,
        CLAUDE_MANIFEST,
        CODEX_MCP_CONFIG,
        CLAUDE_MCP_CONFIG,
        MCP_PACKAGE,
        *REQUIRED_FILES,
    }:
        if not path.is_file():
            fail(f"Missing required file: {path}")

    codex_manifest = load_json(CODEX_MANIFEST)
    claude_manifest = load_json(CLAUDE_MANIFEST)
    codex_config = load_json(CODEX_MCP_CONFIG)
    claude_config = load_json(CLAUDE_MCP_CONFIG)
    mcp_package = load_json(MCP_PACKAGE)
    package_name = mcp_package.get("name")

    if codex_manifest.get("name") != "binance-research-pro":
        fail("Codex manifest name must be binance-research-pro")
    codex_version = codex_manifest.get("version", "")
    codex_match = re.fullmatch(
        r"(?P<core>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\+codex\.\d{14}", codex_version
    )
    if not codex_match:
        fail("Codex manifest version must use X.Y.Z[-prerelease]+codex.YYYYMMDDHHmmss UTC metadata")
    if codex_manifest.get("mcpServers") != "./.mcp.json":
        fail("Codex manifest must reference ./.mcp.json")
    if codex_manifest.get("skills") != "./skills/":
        fail("Codex manifest must reference ./skills/")

    allowed_claude_fields = {"name", "version", "description", "author", "skills", "mcpServers"}
    if set(claude_manifest) - allowed_claude_fields:
        fail("Claude manifest contains unsupported project fields")
    if claude_manifest.get("name") != "binance-research-pro":
        fail("Claude manifest name must be binance-research-pro")
    author = claude_manifest.get("author")
    if not isinstance(author, dict) or not isinstance(author.get("name"), str) or not author["name"]:
        fail("Claude manifest must provide an author name")
    claude_version = claude_manifest.get("version", "")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", claude_version):
        fail("Claude manifest version must be an exact SemVer version")
    if not isinstance(claude_manifest.get("description"), str) or not claude_manifest["description"]:
        fail("Claude manifest must provide a description")
    if claude_manifest.get("skills") != "./skills/":
        fail("Claude manifest must reference ./skills/")
    if claude_manifest.get("mcpServers") != "./claude.mcp.json":
        fail("Claude manifest must reference ./claude.mcp.json")

    codex_pin = validate_mcp_config(codex_config, package_name, codex=True)
    claude_pin = validate_mcp_config(claude_config, package_name, codex=False)
    if codex_pin != claude_pin:
        fail("Codex and Claude MCP configs must pin the same package version")
    if codex_match.group("core") != codex_pin:
        fail("Codex manifest core version must match its MCP package pin")
    if claude_version != claude_pin:
        fail("Claude manifest version must match its MCP package pin")

    skills = {
        path.parent.name
        for path in (ROOT / "skills").glob("*/SKILL.md")
        if path.is_file()
    }
    if skills != EXPECTED_SKILLS:
        fail(f"Unexpected skill set: {sorted(skills)}")

    print("Binance Research Pro dual-client plugin validation passed.")
    print(f"Codex manifest: {CODEX_MANIFEST}")
    print(f"Claude manifest: {CLAUDE_MANIFEST}")
    print(f"MCP package pin: {package_name}@{codex_pin}")
    print(f"Skills: {', '.join(sorted(skills))}")


if __name__ == "__main__":
    main()
