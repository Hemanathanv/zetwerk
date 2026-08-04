import re
from pathlib import Path
from typing import Any


DOC_GENERATION_SQL_PATH = Path(__file__).resolve().parent / "views.sql"
DOC_GENERATION_VIEWS: tuple[str, ...] = (
    "v_packing_list_source",
    "v_us_packing_list_source",
    "v_entry_summary_source",
)
DOC_GENERATION_REQUIRED_COLUMNS: dict[str, set[str]] = {
    "v_packing_list_source": {"source_document_id", "uploaded_by", "created_at"},
    "v_us_packing_list_source": {"packing_list_document_id", "bol_document_id"},
    "v_entry_summary_source": {
        "bol_document_id",
        "sales_invoice_document_id",
        "export_shipping_bill_date",
        "taxable_value",
        "tax_amount",
    },
}


def _split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    dollar_tag: str | None = None
    index = 0

    while index < len(sql):
        char = sql[index]
        nxt = sql[index + 1] if index + 1 < len(sql) else ""

        if dollar_tag:
            current.append(char)
            if sql.startswith(dollar_tag, index):
                current.extend(sql[index + 1 : index + len(dollar_tag)])
                index += len(dollar_tag)
                dollar_tag = None
                continue
            index += 1
            continue

        if not in_single_quote and not in_double_quote and char == "-" and nxt == "-":
            while index < len(sql) and sql[index] != "\n":
                index += 1
            continue

        if not in_single_quote and not in_double_quote and char == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", sql[index:])
            if match:
                dollar_tag = match.group(0)
                current.append(dollar_tag)
                index += len(dollar_tag)
                continue

        if char == "'" and not in_double_quote:
            current.append(char)
            if in_single_quote and nxt == "'":
                current.append(nxt)
                index += 2
                continue
            in_single_quote = not in_single_quote
            index += 1
            continue

        if char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
            current.append(char)
            index += 1
            continue

        if char == ";" and not in_single_quote and not in_double_quote:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            index += 1
            continue

        current.append(char)
        index += 1

    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


def _view_name_from_statement(statement: str) -> str | None:
    match = re.match(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+docgen\.([A-Za-z_][A-Za-z0-9_]*)\s+AS\b",
        statement,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return match.group(1) if match else None


async def _query_raw(prisma: Any, sql: str, *params) -> list[dict[str, Any]]:
    query_raw = getattr(prisma, "query_raw", None)
    if query_raw is None:
        raise RuntimeError("Prisma client has no query_raw")
    rows = await query_raw(sql, *params)
    return [dict(row) for row in rows]


async def _execute_raw(prisma: Any, sql: str) -> Any:
    execute_raw = getattr(prisma, "execute_raw", None)
    if execute_raw is None:
        raise RuntimeError("Prisma client has no execute_raw")
    return await execute_raw(sql)


async def existing_doc_generation_views(prisma: Any) -> set[str]:
    rows = await _query_raw(
        prisma,
        """
        SELECT viewname
        FROM pg_catalog.pg_views
        WHERE schemaname = 'docgen'
        """,
    )
    expected = set(DOC_GENERATION_VIEWS)
    return {str(row["viewname"]) for row in rows if row.get("viewname") in expected}


async def incompatible_doc_generation_views(prisma: Any, existing_views: set[str]) -> set[str]:
    incompatible: set[str] = set()
    for view_name in existing_views:
        required_columns = DOC_GENERATION_REQUIRED_COLUMNS.get(view_name, set())
        if not required_columns:
            continue
        rows = await _query_raw(
            prisma,
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'docgen'
              AND table_name = $1
            """,
            view_name,
        )
        existing_columns = {
            str(row["column_name"])
            for row in rows
            if row.get("column_name") in required_columns
        }
        if not existing_columns.issuperset(required_columns):
            incompatible.add(view_name)
    return incompatible


async def ensure_doc_generation_views(prisma: Any) -> set[str]:
    if not DOC_GENERATION_SQL_PATH.exists():
        raise RuntimeError(f"Missing document generation SQL file: {DOC_GENERATION_SQL_PATH}")

    existing_views = await existing_doc_generation_views(prisma)
    incompatible_views = await incompatible_doc_generation_views(prisma, existing_views)
    valid_existing_views = existing_views - incompatible_views
    if valid_existing_views.issuperset(DOC_GENERATION_VIEWS):
        return existing_views

    statements = _split_sql_statements(DOC_GENERATION_SQL_PATH.read_text(encoding="utf-8"))
    created_or_existing = set(valid_existing_views)
    for statement in statements:
        view_name = _view_name_from_statement(statement)
        if view_name and view_name in created_or_existing:
            continue
        await _execute_raw(prisma, statement)
        if view_name:
            created_or_existing.add(view_name)

    return await existing_doc_generation_views(prisma)
