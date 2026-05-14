from pathlib import Path

from structured_ocr import cli_main, extract_ts_map

DOC_TITLE = "Delivery Deduction Sheet"
SCHEMA_PATH = Path("data/schemas/dds.json")
PROMPT_TS = Path("src/prompts/dds-structured-prompt.ts")

FIELD_KEY_MAP = extract_ts_map(PROMPT_TS, "CANONICAL_JSON_KEY")


if __name__ == "__main__":
    cli_main(
        doc_title=DOC_TITLE,
        schema_path=SCHEMA_PATH,
        prompt_ts_path=PROMPT_TS,
        array_sections=["Reference Invoices"],
        key_style="camel",
        field_key_map=FIELD_KEY_MAP,
        expand_array_key="referenceInvoices",
    )
