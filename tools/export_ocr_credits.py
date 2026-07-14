from __future__ import annotations

import asyncio
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from db import close_prisma, get_prisma  # noqa: E402


OUTPUT_PATH = REPO_ROOT / "ocr_credits_pagewise.xlsx"


def decimal_value(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def int_value(value: Any) -> int:
    if value is None:
        return 0
    return int(value)


def text_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).replace(tzinfo=None).isoformat(sep=" ", timespec="seconds")
    return str(value)


def number_cell(ref: str, value: int | float | Decimal) -> str:
    if isinstance(value, Decimal):
        value = format(value, "f")
    return f'<c r="{ref}"><v>{value}</v></c>'


def text_cell(ref: str, value: Any) -> str:
    return f'<c r="{ref}" t="inlineStr"><is><t>{escape(text_value(value))}</t></is></c>'


def col_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def sheet_xml(headers: list[str], rows: list[list[Any]]) -> str:
    xml_rows = []
    header_cells = [text_cell(f"{col_name(i)}1", header) for i, header in enumerate(headers, start=1)]
    xml_rows.append(f'<row r="1">{"".join(header_cells)}</row>')

    for row_index, row in enumerate(rows, start=2):
        cells = []
        for col_index, value in enumerate(row, start=1):
            ref = f"{col_name(col_index)}{row_index}"
            if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
                cells.append(number_cell(ref, value))
            else:
                cells.append(text_cell(ref, value))
        xml_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    dimension = f"A1:{col_name(max(1, len(headers)))}{max(1, len(rows) + 1)}"
    cols = "".join(
        f'<col min="{i}" max="{i}" width="{min(max(len(header) + 2, 12), 36)}" customWidth="1"/>'
        for i, header in enumerate(headers, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="{dimension}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>'
        f"<cols>{cols}</cols><sheetData>{''.join(xml_rows)}</sheetData>"
        '<autoFilter ref="A1:'
        f'{col_name(max(1, len(headers)))}{max(1, len(rows) + 1)}"/>'
        "</worksheet>"
    )


def write_xlsx(path: Path, sheets: list[tuple[str, list[str], list[list[Any]]]]) -> None:
    workbook_sheets = []
    workbook_rels = []
    content_overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ]
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )

    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr(
            "xl/styles.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
            '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
            "</styleSheet>",
        )

        for index, (name, headers, rows) in enumerate(sheets, start=1):
            workbook_sheets.append(f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>')
            workbook_rels.append(
                f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
            )
            content_overrides.append(
                f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            )
            archive.writestr(f"xl/worksheets/sheet{index}.xml", sheet_xml(headers, rows))

        archive.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f"<sheets>{''.join(workbook_sheets)}</sheets></workbook>",
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f"{''.join(workbook_rels)}</Relationships>",
        )
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            f"{''.join(content_overrides)}</Types>",
        )


async def fetch_usage_rows() -> list[dict[str, Any]]:
    prisma = await get_prisma()
    query = """
        SELECT
            u.id AS usage_id,
            u.called_at,
            u.doc_type,
            u.task_type,
            u.model_id,
            u.provider,
            d.id AS document_id,
            d.file_name,
            d.total_pages,
            p.page_no,
            u.input_tokens,
            u.output_tokens,
            u.total_tokens,
            COALESCE(u.image_count, 0) AS image_count,
            u.input_cost_usd,
            u.output_cost_usd,
            u.image_cost_usd,
            u.total_cost_usd,
            u.is_retry,
            u.processing_ms
        FROM aiextraction.ai_usage_records u
        JOIN public.documents d ON d.id = u.document_id
        LEFT JOIN public.document_pages p ON p.id = u.page_id
        WHERE u.task_type = 'ocr'
        ORDER BY u.called_at ASC, d.file_name ASC, p.page_no ASC NULLS LAST
    """
    try:
        return await prisma.query_raw(query)
    finally:
        await close_prisma()


def build_sheets(rows: list[dict[str, Any]]) -> list[tuple[str, list[str], list[list[Any]]]]:
    page_headers = [
        "Called At",
        "Document ID",
        "File Name",
        "Doc Type",
        "Page No",
        "Total Pages",
        "Model",
        "Provider",
        "Input Tokens",
        "Output Tokens",
        "Total Tokens",
        "Image Count",
        "Input Cost USD",
        "Output Cost USD",
        "Image Cost USD",
        "Total Cost USD",
        "Is Retry",
        "Processing MS",
        "Usage Record ID",
    ]
    page_rows = []
    by_doc: dict[str, dict[str, Any]] = {}
    by_type: dict[str, dict[str, Any]] = defaultdict(lambda: defaultdict(Decimal))
    total = defaultdict(Decimal)

    for row in rows:
        cost = decimal_value(row.get("total_cost_usd"))
        input_cost = decimal_value(row.get("input_cost_usd"))
        output_cost = decimal_value(row.get("output_cost_usd"))
        image_cost = decimal_value(row.get("image_cost_usd"))
        input_tokens = int_value(row.get("input_tokens"))
        output_tokens = int_value(row.get("output_tokens"))
        total_tokens = int_value(row.get("total_tokens"))
        image_count = int_value(row.get("image_count"))
        doc_id = text_value(row.get("document_id"))
        doc_type = text_value(row.get("doc_type"))

        page_rows.append([
            text_value(row.get("called_at")),
            doc_id,
            row.get("file_name"),
            doc_type,
            int_value(row.get("page_no")) if row.get("page_no") is not None else "",
            int_value(row.get("total_pages")) if row.get("total_pages") is not None else "",
            row.get("model_id"),
            row.get("provider"),
            input_tokens,
            output_tokens,
            total_tokens,
            image_count,
            input_cost,
            output_cost,
            image_cost,
            cost,
            "Yes" if row.get("is_retry") else "No",
            int_value(row.get("processing_ms")) if row.get("processing_ms") is not None else "",
            row.get("usage_id"),
        ])

        doc = by_doc.setdefault(
            doc_id,
            {
                "file_name": row.get("file_name"),
                "doc_type": doc_type,
                "total_pages": int_value(row.get("total_pages")),
                "records": 0,
                "pages": set(),
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "image_count": 0,
                "input_cost": Decimal("0"),
                "output_cost": Decimal("0"),
                "image_cost": Decimal("0"),
                "total_cost": Decimal("0"),
            },
        )
        doc["records"] += 1
        if row.get("page_no") is not None:
            doc["pages"].add(int_value(row.get("page_no")))
        doc["input_tokens"] += input_tokens
        doc["output_tokens"] += output_tokens
        doc["total_tokens"] += total_tokens
        doc["image_count"] += image_count
        doc["input_cost"] += input_cost
        doc["output_cost"] += output_cost
        doc["image_cost"] += image_cost
        doc["total_cost"] += cost

        for bucket in (by_type[doc_type], total):
            bucket["documents"] += Decimal("0")
            bucket["usage_records"] += Decimal(1)
            bucket["input_tokens"] += Decimal(input_tokens)
            bucket["output_tokens"] += Decimal(output_tokens)
            bucket["total_tokens"] += Decimal(total_tokens)
            bucket["image_count"] += Decimal(image_count)
            bucket["input_cost"] += input_cost
            bucket["output_cost"] += output_cost
            bucket["image_cost"] += image_cost
            bucket["total_cost"] += cost

    for doc in by_doc.values():
        by_type[doc["doc_type"]]["documents"] += Decimal(1)
        total["documents"] += Decimal(1)

    doc_headers = [
        "Document ID",
        "File Name",
        "Doc Type",
        "Total Pages",
        "OCR Pages With Usage",
        "Usage Records",
        "Input Tokens",
        "Output Tokens",
        "Total Tokens",
        "Image Count",
        "Input Cost USD",
        "Output Cost USD",
        "Image Cost USD",
        "Total Cost USD",
    ]
    doc_rows = [
        [
            doc_id,
            doc["file_name"],
            doc["doc_type"],
            doc["total_pages"],
            len(doc["pages"]),
            doc["records"],
            doc["input_tokens"],
            doc["output_tokens"],
            doc["total_tokens"],
            doc["image_count"],
            doc["input_cost"],
            doc["output_cost"],
            doc["image_cost"],
            doc["total_cost"],
        ]
        for doc_id, doc in sorted(by_doc.items(), key=lambda item: str(item[1]["file_name"]))
    ]

    summary_headers = [
        "Doc Type",
        "Documents",
        "Usage Records",
        "Input Tokens",
        "Output Tokens",
        "Total Tokens",
        "Image Count",
        "Input Cost USD",
        "Output Cost USD",
        "Image Cost USD",
        "Total Cost USD",
    ]
    summary_rows = [
        [
            doc_type,
            int(stats["documents"]),
            int(stats["usage_records"]),
            int(stats["input_tokens"]),
            int(stats["output_tokens"]),
            int(stats["total_tokens"]),
            int(stats["image_count"]),
            stats["input_cost"],
            stats["output_cost"],
            stats["image_cost"],
            stats["total_cost"],
        ]
        for doc_type, stats in sorted(by_type.items())
    ]
    summary_rows.append([
        "TOTAL",
        int(total["documents"]),
        int(total["usage_records"]),
        int(total["input_tokens"]),
        int(total["output_tokens"]),
        int(total["total_tokens"]),
        int(total["image_count"]),
        total["input_cost"],
        total["output_cost"],
        total["image_cost"],
        total["total_cost"],
    ])

    notes_headers = ["Field", "Value"]
    notes_rows = [
        ["Generated At", datetime.now().isoformat(sep=" ", timespec="seconds")],
        ["Source Table", "aiextraction.ai_usage_records joined to public.documents/public.document_pages"],
        ["Definition", "One row per recorded OCR usage allocation per page."],
        ["Credit Column", "Total Cost USD. If model pricing is zero/missing in ai_model_registry, cost columns will be 0 even when tokens exist."],
        ["Rows Exported", len(rows)],
    ]

    return [
        ("Pagewise Usage", page_headers, page_rows),
        ("By Document", doc_headers, doc_rows),
        ("Summary", summary_headers, summary_rows),
        ("Notes", notes_headers, notes_rows),
    ]


async def main() -> None:
    rows = await fetch_usage_rows()
    write_xlsx(OUTPUT_PATH, build_sheets(rows))
    print(f"Wrote {OUTPUT_PATH}")
    print(f"Usage rows: {len(rows)}")


if __name__ == "__main__":
    asyncio.run(main())
