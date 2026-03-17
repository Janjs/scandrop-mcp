from __future__ import annotations

from scandrop_mcp.mcp_tools import mcp


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
