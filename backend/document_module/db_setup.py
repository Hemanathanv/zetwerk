from pathlib import Path
from typing import Any


DOCUMENT_MODULE_SQL_PATH = Path(__file__).resolve().parent / "views.sql"
DOCUMENT_MODULE_VIEWS = ("v_shipment_gate_documents",)
DOCUMENT_MODULE_MAPPING_VERSION = 5


def _split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    for char in sql:
        if char == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
        elif char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
        if char == ";" and not in_single_quote and not in_double_quote:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
        else:
            current.append(char)
    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


async def _sql_for_live_extraction_schema(prisma: Any, sql: str) -> str:
    """Drop optional UNION branches whose extraction table is not migrated."""
    rows = await prisma.query_raw(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'aiextraction'
        """
    )
    existing_tables = {str(row["table_name"]) for row in rows}
    compatible_lines: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("UNION ALL"):
            marker = "FROM aiextraction."
            marker_index = line.find(marker)
            if marker_index >= 0:
                table_name = line[marker_index + len(marker):].split()[0]
                if table_name not in existing_tables:
                    continue
        compatible_lines.append(line)
    return "\n".join(compatible_lines)


async def ensure_document_module_views(prisma: Any) -> set[str]:
    if not DOCUMENT_MODULE_SQL_PATH.exists():
        raise RuntimeError(f"Missing document module SQL: {DOCUMENT_MODULE_SQL_PATH}")

    rows = await prisma.query_raw(
        """
        SELECT viewname
        FROM pg_catalog.pg_views
        WHERE schemaname = 'document_module'
        """
    )
    expected = set(DOCUMENT_MODULE_VIEWS)
    existing = {
        str(row["viewname"])
        for row in rows
        if row.get("viewname") in expected
    }
    if existing.issuperset(expected):
        column_rows = await prisma.query_raw(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'document_module'
              AND table_name = 'v_shipment_gate_documents'
            """
        )
        columns = {str(row["column_name"]) for row in column_rows}
        if {"shipment_id", "mapping_version"}.issubset(columns):
            version_rows = await prisma.query_raw(
                """
                SELECT COALESCE(MAX(mapping_version), 0) AS mapping_version
                FROM document_module.v_shipment_gate_documents
                """
            )
            current_version = 0
            if version_rows:
                current_version = int(version_rows[0].get("mapping_version") or 0)
            if current_version >= DOCUMENT_MODULE_MAPPING_VERSION:
                return existing

    sql = await _sql_for_live_extraction_schema(
        prisma,
        DOCUMENT_MODULE_SQL_PATH.read_text(encoding="utf-8"),
    )
    statements = _split_sql_statements(sql)
    for statement in statements:
        await prisma.execute_raw(statement)

    rows = await prisma.query_raw(
        """
        SELECT viewname
        FROM pg_catalog.pg_views
        WHERE schemaname = 'document_module'
        """
    )
    return {
        str(row["viewname"])
        for row in rows
        if row.get("viewname") in expected
    }
